import {
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    LanguageCode,
    PaymentMethodHandler,
    SettlePaymentResult,
} from '@vendure/core';

import { toMajorUnits, toMinorUnits } from './cashfree-utils';
import { CashfreeService } from './cashfree.service';
import { CashfreeEnvironment } from './types';

let cashfreeService: CashfreeService;

/**
 * The handler for Cashfree payments.
 */
export const cashfreePaymentMethodHandler = new PaymentMethodHandler({
    code: 'cashfree',

    description: [{ languageCode: LanguageCode.en, value: 'Cashfree payments' }],

    args: {
        apiKey: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Client ID' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The Cashfree Client ID (x-client-id), from the Cashfree Merchant Dashboard.',
                },
            ],
            ui: { component: 'password-form-input' },
        },
        apiSecret: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Client Secret' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The Cashfree Client Secret (x-client-secret), from the Cashfree Merchant Dashboard. Also used to verify webhook signatures.',
                },
            ],
            ui: { component: 'password-form-input' },
        },
        environment: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Environment' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Whether these credentials point at the Cashfree sandbox or production environment.',
                },
            ],
            defaultValue: 'SANDBOX',
            ui: {
                component: 'select-form-input',
                options: [{ value: 'SANDBOX' }, { value: 'PRODUCTION' }],
            },
        },
    },

    init(injector: Injector) {
        cashfreeService = injector.get(CashfreeService);
    },

    async createPayment(ctx, order, amount, args, metadata): Promise<CreatePaymentResult> {
        const cfOrderId = metadata.cfOrderId as string | undefined;
        if (!cfOrderId) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Missing Cashfree order id' },
            };
        }

        const environment = args.environment as CashfreeEnvironment;
        let payment;
        try {
            payment = await cashfreeService.fetchSuccessfulPayment(args.apiKey, args.apiSecret, environment, cfOrderId);
        } catch (e: any) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: `Unable to verify Cashfree order: ${e.message}` },
            };
        }

        if (!payment?.cf_payment_id) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'No successful Cashfree payment found for this order' },
            };
        }

        if (Math.abs(toMinorUnits(payment.payment_amount ?? 0) - amount) > 0) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Cashfree payment amount does not match the order total' },
            };
        }

        return {
            amount,
            state: 'Settled' as const,
            transactionId: String(payment.cf_payment_id),
            metadata,
        };
    },

    settlePayment(): SettlePaymentResult {
        return {
            success: true,
        };
    },

    async createRefund(ctx, input, amount, order, payment, args): Promise<CreateRefundResult> {
        const environment = args.environment as CashfreeEnvironment;
        try {
            const refund = await cashfreeService.createRefund(
                args.apiKey,
                args.apiSecret,
                environment,
                order.code,
                `refund-${payment.transactionId}-${Date.now()}`,
                toMajorUnits(amount),
            );
            let state: 'Settled' | 'Pending' | 'Failed';
            if (refund.refund_status === 'SUCCESS') {
                state = 'Settled';
            } else if (refund.refund_status === 'PENDING' || refund.refund_status === 'ONHOLD') {
                // Cashfree settles this asynchronously and notifies via the
                // REFUND_STATUS_WEBHOOK/AUTO_REFUND_STATUS_WEBHOOK events, which the controller
                // reconciles against this transactionId.
                state = 'Pending';
            } else {
                state = 'Failed';
            }
            return {
                state,
                transactionId: String(refund.cf_refund_id),
            };
        } catch (e: any) {
            return {
                state: 'Failed' as const,
                transactionId: payment.transactionId,
                metadata: {
                    message: e.message,
                },
            };
        }
    },
});
