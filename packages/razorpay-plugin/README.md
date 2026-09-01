# Razorpay Payment Plugin

Plugin to enable payments through [Razorpay](https://razorpay.com/docs/) via the Orders API and Checkout.js.

## Requirements

1. You will need a Razorpay account and your Key ID / Key Secret from the dashboard (Settings -> API Keys).
2. Create a webhook in the Razorpay dashboard (Settings -> Webhooks, "Add New Webhook") which listens to the
   `payment.captured`, `payment.failed`, `refund.processed`, and `refund.failed` events. The URL should be
   `https://my-server.com/payments/razorpay`, where `my-server.com` is the host of your Vendure server.
3. Get the webhook secret for the newly created webhook.
4. Install the plugin and the Razorpay Node library:

    ```shell
    npm install @vendure-community/razorpay-plugin razorpay
    ```

## Setup

1. Add the plugin to your VendureConfig `plugins` array:
    ```ts
    import { RazorpayPlugin } from '@vendure-community/razorpay-plugin';

    // ...

    plugins: [
      RazorpayPlugin.init({
        // optional: see the RazorpayPluginOptions type for storeCustomersInRazorpay / refundSpeed
      }),
    ]
    ```
2. Create a new PaymentMethod in the Admin UI, and select "Razorpay payments" as the handler.
3. Set the "Key ID", "Key Secret", and "Webhook Secret" arguments on the PaymentMethod form. Each
   PaymentMethod using the Razorpay handler can be configured with its own Razorpay account, so
   different channels/PaymentMethods can point at different accounts. Only one enabled PaymentMethod
   using the Razorpay handler is supported per channel at a time.

## Storefront Usage

1. Call the `createRazorpayOrder` mutation to create a Razorpay Order for the active order, returning
   `{ orderId, amount, currency, keyId }`.
2. Pass these values into [Razorpay Checkout.js](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/):
   ```js
   const options = {
     key: keyId,
     amount,
     currency,
     order_id: orderId,
     handler: function (response) {
       // response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature
     },
   };
   new Razorpay(options).open();
   ```
3. On success, call Vendure's standard `addPaymentToOrder` mutation with:
   ```json
   {
     "method": "<your payment method code>",
     "metadata": {
       "razorpayOrderId": "<razorpay_order_id>",
       "razorpayPaymentId": "<razorpay_payment_id>",
       "razorpaySignature": "<razorpay_signature>"
     }
   }
   ```
   The plugin verifies the signature server-side before settling the payment.

The `/payments/razorpay` webhook acts as a reconciliation backstop only — it settles the order if the
storefront's `addPaymentToOrder` call never completes (e.g. the browser tab closed after payment).

## Refunds

Creating a refund via the Admin UI (or the `refundOrder` mutation) calls the
[Razorpay Refunds API](https://razorpay.com/docs/api/refunds/create). By default, refunds are processed at
Razorpay's `'normal'` speed and settle asynchronously (typically 5-7 days later); set the `refundSpeed` plugin
option to `'optimum'` to let Razorpay attempt an instant refund where supported, falling back to normal
processing otherwise.

Because a `'normal'`-speed refund is created in a `Pending` state, the plugin registers a custom refund
process that permits a `Pending -> Pending` self-transition (Vendure's default process only allows
`Pending -> Settled | Failed`). The `/payments/razorpay` webhook then reconciles the refund to `Settled` or
`Failed` once Razorpay sends the corresponding `refund.processed`/`refund.failed` event.

## Local Development

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in a `.env` file in this package
(these seed the dev-server's Razorpay PaymentMethod handler arguments, not `RazorpayPlugin.init()`), then run:

```shell
npm run dev-server
```
