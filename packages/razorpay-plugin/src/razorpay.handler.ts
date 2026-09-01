import {
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    LanguageCode,
    PaymentMethodHandler,
    SettlePaymentResult,
} from '@vendure/core';

import { verifyPaymentSignature } from './razorpay-utils';
import { RazorpayService } from './razorpay.service';

let razorpayService: RazorpayService;

/**
 * The handler for Razorpay payments.
 */
export const razorpayPaymentMethodHandler = new PaymentMethodHandler({
    code: 'razorpay',

    description: [{ languageCode: LanguageCode.en, value: 'Razorpay payments' }],

    args: {
        apiKey: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Key ID' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The Razorpay Key ID, from the Razorpay dashboard (Settings -> API Keys).',
                },
            ],
            ui: { component: 'password-form-input' },
        },
        apiSecret: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Key Secret' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The Razorpay Key Secret, from the Razorpay dashboard (Settings -> API Keys). Used to verify the Razorpay payment signature.',
                },
            ],
            ui: { component: 'password-form-input' },
        },
        webhookSecret: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Webhook Secret' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The webhook signing secret configured in the Razorpay dashboard (Settings -> Webhooks), used to verify webhook authenticity.',
                },
            ],
            ui: { component: 'password-form-input' },
        },
    },

    init(injector: Injector) {
        razorpayService = injector.get(RazorpayService);
    },

    createPayment(ctx, order, amount, args, metadata): CreatePaymentResult {
        const razorpayOrderId = metadata.razorpayOrderId as string | undefined;
        const razorpayPaymentId = metadata.razorpayPaymentId as string | undefined;
        const razorpaySignature = metadata.razorpaySignature as string | undefined;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Missing Razorpay payment metadata' },
            };
        }

        const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, args.apiSecret);
        if (!isValid) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Invalid Razorpay payment signature' },
            };
        }

        return {
            amount,
            state: 'Settled' as const,
            transactionId: razorpayPaymentId,
            metadata,
        };
    },

    settlePayment(): SettlePaymentResult {
        return {
            success: true,
        };
    },

    async createRefund(ctx, input, amount, order, payment, args): Promise<CreateRefundResult> {
        try {
            const refund = await razorpayService.createRefund(
                args.apiKey,
                args.apiSecret,
                payment.transactionId,
                amount,
                {
                    channelToken: ctx.channel.token,
                    orderCode: order.code,
                },
            );
            let state: 'Settled' | 'Pending' | 'Failed';
            if (refund.status === 'processed') {
                state = 'Settled';
            } else if (refund.status === 'failed') {
                state = 'Failed';
            } else {
                // 'pending' - Razorpay settles this asynchronously (typically 5-7 days for
                // normal speed refunds) and notifies via the refund.processed/refund.failed
                // webhook events, which the controller reconciles against this transactionId.
                state = 'Pending';
            }
            return {
                state,
                transactionId: refund.id,
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
