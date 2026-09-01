import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigArg, OrderLineInput } from '@vendure/common/lib/generated-types';
import {
    EntityHydrator,
    Fulfillment,
    FulfillmentService,
    JobQueue,
    JobQueueService,
    Logger,
    Order,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';

import { DEFAULT_PARCEL_DIMENSIONS_CM, DEFAULT_UNIT_WEIGHT_KG, loggerCtx, SHIPROCKET_PLUGIN_OPTIONS } from './constants';
import { ShiprocketClient } from './shiprocket-client';
import { mapShiprocketStatusToFulfillmentState } from './shiprocket-utils';
import { shiprocketFulfillmentHandler } from './shiprocket.handler';
import { ShiprocketAccountArgs, ShiprocketPluginOptions } from './types';

export interface ShiprocketFulfillmentResult {
    method: string;
    customFields: {
        shiprocketShipmentId: string;
        shiprocketAwbCode?: string;
        shiprocketCourierName?: string;
    };
}

/**
 * Each ShippingMethod using the `shiprocket-live-rate` calculator can point at a different
 * Shiprocket account (via its calculator args), so this service resolves credentials per-order/
 * per-fulfillment from the relevant ShippingMethod rather than holding a single global client.
 */
@Injectable()
export class ShiprocketService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly clientCache = new Map<string, ShiprocketClient>();
    private pollQueue: JobQueue<Record<string, never>> | undefined;
    private pollTimer: NodeJS.Timeout | undefined;

    constructor(
        @Inject(SHIPROCKET_PLUGIN_OPTIONS) private options: ShiprocketPluginOptions,
        private connection: TransactionalConnection,
        private fulfillmentService: FulfillmentService,
        private requestContextService: RequestContextService,
        private jobQueueService: JobQueueService,
        private entityHydrator: EntityHydrator,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.pollQueue = await this.jobQueueService.createQueue({
            name: 'shiprocket-status-sync',
            process: async () => this.syncFulfillmentStatuses(),
        });

        const intervalMs = (this.options.pollIntervalMinutes ?? 15) * 60 * 1000;
        this.pollTimer = setInterval(() => {
            this.pollQueue?.add({}).catch((e: any) => {
                Logger.error(`Failed to enqueue Shiprocket status sync job: ${e.message}`, loggerCtx);
            });
        }, intervalMs);
    }

    onApplicationShutdown(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    /**
     * `lines` is `OrderLineInput[]` (`{orderLineId, quantity}`), NOT hydrated `OrderLine` entities —
     * that's the shape `FulfillmentHandler.createFulfillment` is called with. The actual variant/price
     * data for each requested line is looked up from the hydrated `orders[].lines`, matched by id.
     */
    async createShipment(
        ctx: RequestContext,
        orders: Order[],
        lines: OrderLineInput[],
    ): Promise<ShiprocketFulfillmentResult> {
        const order = orders[0];
        // Note: `shippingAddress` is an embedded column on `Order` (not a relation), so it doesn't
        // need to be listed here — it's always present on the loaded entity.
        await this.entityHydrator.hydrate(ctx, order, {
            relations: ['customer', 'lines.productVariant', 'shippingLines.shippingMethod'],
        });

        const accountArgs = this.resolveAccountArgs(order);
        const client = this.getClient(accountArgs.email, accountArgs.password);

        const orderItems = lines.map(lineInput => {
            const orderLine = order.lines.find(l => l.id === lineInput.orderLineId);
            if (!orderLine) {
                throw new Error(`OrderLine ${lineInput.orderLineId} not found on order ${order.code}`);
            }
            return {
                name: orderLine.productVariant.name,
                sku: orderLine.productVariant.sku,
                units: lineInput.quantity,
                selling_price: orderLine.proratedUnitPriceWithTax / 100,
            };
        });

        const dimensions = this.options.defaultParcelDimensionsCm ?? DEFAULT_PARCEL_DIMENSIONS_CM;
        const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0);

        const response = await client.createOrder({
            order_id: order.code,
            order_date: order.orderPlacedAt?.toISOString() ?? new Date().toISOString(),
            pickup_location: accountArgs.pickupLocation,
            channel_id: accountArgs.channelId,
            billing_customer_name: order.shippingAddress?.fullName ?? order.customer?.firstName ?? 'Customer',
            billing_last_name: order.customer?.lastName ?? '',
            billing_address: order.shippingAddress?.streetLine1 ?? '',
            billing_city: order.shippingAddress?.city ?? '',
            billing_pincode: order.shippingAddress?.postalCode ?? '',
            billing_state: order.shippingAddress?.province ?? '',
            billing_country: order.shippingAddress?.countryCode ?? '',
            billing_email: order.customer?.emailAddress ?? '',
            billing_phone: order.shippingAddress?.phoneNumber ?? order.customer?.phoneNumber ?? '',
            shipping_is_billing: true,
            order_items: orderItems,
            payment_method: 'Prepaid',
            sub_total: order.subTotalWithTax / 100,
            length: dimensions.length,
            breadth: dimensions.breadth,
            height: dimensions.height,
            weight: totalUnits * (this.options.defaultUnitWeightKg ?? DEFAULT_UNIT_WEIGHT_KG),
        });

        const awbResult = await client.assignAwb({
            shipment_id: response.shipment_id,
            ...(accountArgs.defaultCourierId ? { courier_id: Number(accountArgs.defaultCourierId) } : {}),
        });
        if (awbResult.awb_assign_status !== 1 || !awbResult.response.data.awb_code) {
            throw new Error(`Shiprocket AWB assignment failed for shipment ${response.shipment_id}`);
        }

        const manualPickupHint = 'it may need to be scheduled manually from the Shiprocket dashboard';
        try {
            const pickupResult = await client.generatePickup(response.shipment_id);
            if (pickupResult.pickup_status !== 1) {
                Logger.warn(
                    `Shiprocket pickup generation did not confirm for shipment ${response.shipment_id} - ${manualPickupHint}`,
                    loggerCtx,
                );
            }
        } catch (e: any) {
            Logger.warn(
                `Shiprocket pickup generation failed for shipment ${response.shipment_id}: ${e.message} - ${manualPickupHint}`,
                loggerCtx,
            );
        }

        return {
            method: 'Shiprocket',
            customFields: {
                shiprocketShipmentId: String(response.shipment_id),
                shiprocketAwbCode: awbResult.response.data.awb_code,
                shiprocketCourierName: awbResult.response.data.courier_name,
            },
        };
    }

    async getLiveRate(ctx: RequestContext, order: Order, args: ShiprocketAccountArgs): Promise<number | undefined> {
        if (!order.shippingAddress?.postalCode) {
            return undefined;
        }
        await this.entityHydrator.hydrate(ctx, order, { relations: ['lines'] });
        const totalUnits = order.lines.reduce((sum, line) => sum + line.quantity, 0);
        const client = this.getClient(args.email, args.password);
        const response = await client.checkServiceability({
            pickup_postcode: args.pickupPostcode,
            delivery_postcode: order.shippingAddress.postalCode,
            weight: totalUnits * (this.options.defaultUnitWeightKg ?? DEFAULT_UNIT_WEIGHT_KG),
            cod: 0,
        });
        const couriers = response.data.available_courier_companies;
        const courier = args.defaultCourierId
            ? couriers.find(c => String(c.courier_company_id) === args.defaultCourierId)
            : couriers[0];
        return courier ? Math.round(courier.rate * 100) : undefined;
    }

    /**
     * Returns a cached, already-authenticated `ShiprocketClient` for the given account, creating and
     * caching one if needed — `ShiprocketClient` caches its bearer token in memory, so reusing the
     * same instance across calls to the same account avoids re-authenticating on every request.
     */
    private getClient(email: string, password: string): ShiprocketClient {
        let client = this.clientCache.get(email);
        if (!client) {
            client = new ShiprocketClient(email, password);
            this.clientCache.set(email, client);
        }
        return client;
    }

    /**
     * Resolves the Shiprocket account credentials from the order's Shiprocket-fulfilled
     * ShippingLine's ShippingMethod calculator args - each ShippingMethod (and therefore each
     * Channel it's assigned to) can point at a different Shiprocket account.
     */
    private resolveAccountArgs(order: Order): ShiprocketAccountArgs {
        const shippingLine = order.shippingLines?.find(
            line => line.shippingMethod?.fulfillmentHandlerCode === shiprocketFulfillmentHandler.code,
        );
        if (!shippingLine?.shippingMethod) {
            throw new Error(`Order ${order.code} has no ShippingLine using the Shiprocket fulfillment handler`);
        }
        const args = shippingLine.shippingMethod.calculator.args;
        return {
            email: this.findArgValue(args, 'email'),
            password: this.findArgValue(args, 'password'),
            pickupLocation: this.findArgValue(args, 'pickupLocation'),
            channelId: this.findArgValue(args, 'channelId'),
            pickupPostcode: this.findArgValue(args, 'pickupPostcode'),
            defaultCourierId: args.find(arg => arg.name === 'defaultCourierId')?.value || undefined,
        };
    }

    private findArgValue(args: ConfigArg[], name: string): string {
        const value = args.find(arg => arg.name === name)?.value;
        if (!value) {
            throw new Error(`No '${name}' argument configured on the ShippingMethod's Shiprocket calculator`);
        }
        return value;
    }

    private async syncFulfillmentStatuses(): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const fulfillments = await this.connection.getRepository(ctx, Fulfillment).find({
            where: [{ state: 'Pending' }, { state: 'Shipped' }],
            relations: ['orders', 'orders.shippingLines', 'orders.shippingLines.shippingMethod'],
        });

        for (const fulfillment of fulfillments) {
            const shipmentId = fulfillment.customFields?.shiprocketShipmentId;
            if (!shipmentId) {
                continue;
            }
            let accountArgs: ShiprocketAccountArgs;
            try {
                accountArgs = this.resolveAccountArgs(fulfillment.orders[0]);
            } catch (e: any) {
                Logger.warn(
                    `Skipping Shiprocket status sync for fulfillment ${fulfillment.id}: ${e.message}`,
                    loggerCtx,
                );
                continue;
            }
            try {
                const client = this.getClient(accountArgs.email, accountArgs.password);
                const tracking = await client.trackShipment(shipmentId);
                const nextState = mapShiprocketStatusToFulfillmentState(
                    tracking.tracking_data.shipment_status,
                    fulfillment.state,
                );
                if (!nextState) {
                    continue;
                }
                const result = await this.fulfillmentService.transitionToState(ctx, fulfillment.id, nextState);
                if ('errorCode' in result) {
                    Logger.warn(
                        `Could not transition fulfillment ${fulfillment.id} to ${nextState}: ${result.message}`,
                        loggerCtx,
                    );
                } else {
                    Logger.info(`Fulfillment ${fulfillment.id} transitioned to ${nextState}`, loggerCtx);
                }
            } catch (e: any) {
                Logger.error(`Shiprocket status sync failed for fulfillment ${fulfillment.id}: ${e.message}`, loggerCtx);
            }
        }
    }
}
