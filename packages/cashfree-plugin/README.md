# Cashfree Payment Plugin

Plugin to enable payments through [Cashfree](https://www.cashfree.com/docs/payments/overview) via the Orders
API and the Cashfree Checkout JS SDK.

## Requirements

1. You will need a Cashfree Merchant Dashboard account and your Client ID / Client Secret (Developers ->
   API Keys).
2. Register a webhook in the Cashfree Merchant Dashboard (Developers -> Webhooks) which listens to the
   `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `REFUND_STATUS_WEBHOOK`, and
   `AUTO_REFUND_STATUS_WEBHOOK` events. The URL should be `https://my-server.com/payments/cashfree`, where
   `my-server.com` is the host of your Vendure server.
3. Install the plugin and the Cashfree Node SDK:

    ```shell
    npm install @vendure-community/cashfree-plugin cashfree-pg
    ```

## Setup

1. Add the plugin to your VendureConfig `plugins` array:
    ```ts
    import { CashfreePlugin } from '@vendure-community/cashfree-plugin';

    // ...

    plugins: [
      CashfreePlugin.init({
        // optional: see the CashfreePluginOptions type for refundSpeed
      }),
    ]
    ```
2. Create a new PaymentMethod in the Admin UI, and select "Cashfree payments" as the handler.
3. Set the "Client ID", "Client Secret", and "Environment" (Sandbox/Production) arguments on the
   PaymentMethod form. Each PaymentMethod using the Cashfree handler can be configured with its own Cashfree
   account, so different channels/PaymentMethods can point at different accounts. Only one enabled
   PaymentMethod using the Cashfree handler is supported per channel at a time.

## Storefront Usage

1. Call the `createCashfreeOrder` mutation to create a Cashfree Order for the active order, returning
   `{ orderId, paymentSessionId, environment }`.
2. Load the [Cashfree Checkout JS SDK](https://www.cashfree.com/docs/tools-ai/sdk) and open the checkout
   modal:
   ```js
   const cashfree = await load({ mode: environment.toLowerCase() }); // 'sandbox' | 'production'
   const result = await cashfree.checkout({
     paymentSessionId,
     redirectTarget: '_modal',
   });
   ```
3. Once the modal resolves, call Vendure's standard `addPaymentToOrder` mutation with:
   ```json
   {
     "method": "<your payment method code>",
     "metadata": {
       "cfOrderId": "<orderId from createCashfreeOrder>"
     }
   }
   ```
   The plugin does not trust the client-side checkout result (Cashfree's client-side flow carries no signed
   proof equivalent to Razorpay's `razorpay_signature`); instead it independently fetches the order's
   payments from the Cashfree API server-side and only settles once a payment with `payment_status: 'SUCCESS'`
   and a matching amount is found.

The `/payments/cashfree` webhook acts as a reconciliation backstop only - it settles the order if the
storefront's `addPaymentToOrder` call never completes (e.g. the browser tab closed after payment).

## Multi-channel / multi-account support

Like the Razorpay plugin, each channel can have its own Cashfree PaymentMethod - so different channels/storefronts
can point at entirely different Cashfree accounts (own Client ID/Secret/Environment). This works because
`CashfreeService.resolveForOrder` resolves the PaymentMethod (and therefore the credentials) from a
channel-scoped `RequestContext`, not from any plugin-wide configuration.

Webhook routing is channel-aware too:

- **Payment webhooks** echo back the `order_tags` set at order-creation time (`channelToken`/`languageCode`),
  so the channel is identified directly from the payload.
- **Refund webhooks** (`REFUND_STATUS_WEBHOOK` / `AUTO_REFUND_STATUS_WEBHOOK`) carry no such custom metadata,
  since Cashfree's Refunds API has no arbitrary metadata field. Instead, the controller looks up which
  channel the order actually belongs to directly (`cashfree.controller.ts#resolveChannelTokenForOrderCode`)
  and verifies the webhook signature against that channel's PaymentMethod credentials - so refunds reconcile
  correctly regardless of which channel/account processed the original payment.

## Refunds

Creating a refund via the Admin UI (or the `refundOrder` mutation) calls the
[Cashfree Refunds API](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund). By
default, refunds are processed at Cashfree's `'STANDARD'` speed; set the `refundSpeed` plugin option to
`'INSTANT'` to attempt an instant refund where supported, falling back to standard processing otherwise.

Because a refund can return `refund_status: 'PENDING'` or `'ONHOLD'`, the plugin registers a custom refund
process that permits a `Pending -> Pending` self-transition (Vendure's default process only allows
`Pending -> Settled | Failed`). The `/payments/cashfree` webhook then reconciles the refund to `Settled` or
`Failed` once Cashfree sends the corresponding webhook event.

## Local Development

Set `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET` in a `.env` file in this package (these seed the
dev-server's Cashfree PaymentMethod handler arguments, not `CashfreePlugin.init()`), then run:

```shell
npm run dev-server
```
