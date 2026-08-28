# Shiprocket Shipping & Fulfillment Plugin

Plugin to enable shipping rate calculation and order fulfillment through [Shiprocket](https://www.shiprocket.in/).

## Requirements

1. A Shiprocket account with API access enabled (email/password login).
2. A pickup location configured in your Shiprocket account, whose postcode you'll use as the `channelId` option.
3. Install the plugin:

    ```shell
    npm install @vendure-community/shiprocket-plugin
    ```

## Setup

1. Add the plugin to your VendureConfig `plugins` array:
    ```ts
    import { ShiprocketPlugin } from '@vendure-community/shiprocket-plugin';

    // ...

    plugins: [
      ShiprocketPlugin.init({
        email: process.env.SHIPROCKET_EMAIL!,
        password: process.env.SHIPROCKET_PASSWORD!,
        channelId: process.env.SHIPROCKET_CHANNEL_ID!,
        flatRateFallback: 500, // 5.00 in the store's currency, used if live rates fail
        pollIntervalMinutes: 15, // how often to check Shiprocket for status changes
      }),
    ]
    ```
    For all the plugin options, see the `ShiprocketPluginOptions` type.
2. Create a new ShippingMethod in the Admin UI:
   - Calculator: "Shiprocket live shipping rate" (`shiprocket-live-rate`)
   - Fulfillment handler: "Ship via Shiprocket" (`shiprocket`)

## Admin Usage

When an order is fulfilled via the "Ship via Shiprocket" handler, the plugin creates a shipment in
Shiprocket and stores the resulting `shiprocketShipmentId`, `shiprocketAwbCode`, and
`shiprocketCourierName` as Fulfillment custom fields.

## Status Sync

Shiprocket webhook delivery must be configured per-channel in their dashboard and is not
provisionable via API, so this plugin polls the Track/Shipment-status API instead, via a recurring
Vendure job queue task (`shiprocket-status-sync`, visible in the Admin UI under Job Queue). By
default this runs every 15 minutes; configure via `pollIntervalMinutes`. Fulfillments transition
`Pending -> Shipped -> Delivered`, or to `Cancelled` on RTO/cancellation, based on the tracked
status. Failures are logged and retried on the next cycle.

## Local Development

Set `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, and `SHIPROCKET_CHANNEL_ID` in a `.env` file in this
package, then run:

```shell
npm run dev-server
```
