/**
 * @description
 * Allows a Refund to remain in the `Pending` state after creation. Razorpay refunds created
 * at 'normal' speed (the default) return `status: 'pending'` and settle asynchronously,
 * typically 5-7 days later, notified via the `refund.processed`/`refund.failed` webhook events
 * (see `razorpay.handler.ts#createRefund` and `razorpay.controller.ts#handleRefundEvent`).
 *
 * Vendure's default refund process only allows `Pending -> Settled | Failed`, so without this
 * `Pending -> Pending` self-transition, creating a still-pending Razorpay refund would fail
 * with a RefundStateTransitionError.
 */
export const razorpayRefundProcess = {
    transitions: {
        Pending: {
            to: ['Pending'],
        },
    },
};
