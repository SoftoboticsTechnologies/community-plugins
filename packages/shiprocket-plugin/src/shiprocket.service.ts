import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OrderLineInput } from '@vendure/common/lib/generated-types';
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

import { loggerCtx, SHIPROCKET_PLUGIN_OPTIONS } from './constants';
import { ShiprocketClient } from './shiprocket-client';
import { mapShiprocketStatusToFulfillmentState } from './shiprocket-utils';
import { ShiprocketPluginOptions } from './types';

export interface ShiprocketFulfillmentResult {
    method: string;
    customFields: {
        shiprocketShipmentId: string;
        shiprocketAwbCode?: string;
        shiprocketCourierName?: string;
    };
}

@Injectable()
export class ShiprocketService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly client: ShiprocketClient;
    private pollQueue: JobQueue<Record<string, never>> | undefined;
    private pollTimer: NodeJS.Timeout | undefined;

    constructor(
        @Inject(SHIPROCKET_PLUGIN_OPTIONS) private options: ShiprocketPluginOptions,
        private connection: TransactionalConnection,
        private fulfillmentService: FulfillmentService,
        private requestContextService: RequestContextService,
        private jobQueueService: JobQueueService,
        private entityHydrator: EntityHydrator,
    ) {
        this.client = new ShiprocketClient(this.options.email, this.options.password);
    }

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
            relations: ['customer', 'lines.productVariant'],
        });

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

        const response = await this.client.createOrder({
            order_id: order.code,
            order_date: order.orderPlacedAt?.toISOString() ?? new Date().toISOString(),
            pickup_location: this.options.channelId,
            channel_id: this.options.channelId,
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
            length: 10,
            breadth: 10,
            height: 10,
            weight: 0.5,
        });

        return {
            method: 'Shiprocket',
            customFields: {
                shiprocketShipmentId: String(response.shipment_id),
                shiprocketAwbCode: response.awb_code,
                shiprocketCourierName: response.courier_name,
            },
        };
    }

    async getLiveRate(ctx: RequestContext, order: Order): Promise<number | undefined> {
        if (!order.shippingAddress?.postalCode) {
            return undefined;
        }
        const response = await this.client.checkServiceability({
            pickup_postcode: this.options.channelId,
            delivery_postcode: order.shippingAddress.postalCode,
            weight: 0.5,
            cod: 0,
        });
        const couriers = response.data.available_courier_companies;
        const courier = this.options.defaultCourierId
            ? couriers.find(c => String(c.courier_company_id) === this.options.defaultCourierId)
            : couriers[0];
        return courier ? Math.round(courier.rate * 100) : undefined;
    }

    private async syncFulfillmentStatuses(): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const fulfillments = await this.connection.getRepository(ctx, Fulfillment).find({
            where: [{ state: 'Pending' }, { state: 'Shipped' }],
        });

        for (const fulfillment of fulfillments) {
            const shipmentId = fulfillment.customFields?.shiprocketShipmentId;
            if (!shipmentId) {
                continue;
            }
            try {
                const tracking = await this.client.trackShipment(shipmentId);
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
