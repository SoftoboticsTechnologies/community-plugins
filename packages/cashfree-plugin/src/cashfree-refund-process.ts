/**
 * @description
 * Allows a Refund to remain in the `Pending` state after creation. Cashfree refunds can return
 * `refund_status: 'PENDING'` or `'ONHOLD'` and settle asynchronously, notified via the
 * `REFUND_STATUS_WEBHOOK`/`AUTO_REFUND_STATUS_WEBHOOK` events (see `cashfree.handler.ts#createRefund`
 * and `cashfree.controller.ts#handleRefundEvent`).
 *
 * Vendure's default refund process only allows `Pending -> Settled | Failed`, so without this
 * `Pending -> Pending` self-transition, creating a still-pending Cashfree refund would fail with a
 * RefundStateTransitionError.
 */
export const cashfreeRefundProcess = {
    transitions: {
        Pending: {
            to: ['Pending'],
        },
    },
};
