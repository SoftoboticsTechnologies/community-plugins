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
        apiSecret: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Key Secret' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Used to verify the Razorpay payment signature. Must match the plugin-level apiSecret option.',
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

    async createRefund(ctx, input, amount, order, payment): Promise<CreateRefundResult> {
        try {
            const refund = await razorpayService.createRefund(payment.transactionId, amount);
            return {
                state: refund.status === 'processed' ? ('Settled' as const) : ('Pending' as const),
                transactionId: payment.transactionId,
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
