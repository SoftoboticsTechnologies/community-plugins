# Shiprocket Shipping & Fulfillment Plugin

Plugin to enable shipping rate calculation and order fulfillment through [Shiprocket](https://www.shiprocket.in/).

## Requirements

1. A Shiprocket account with API access enabled (email/password login).
2. A pickup address configured in your Shiprocket account (Settings > Pickup Addresses) - note its
   nickname (`pickupLocation`) and postcode (`pickupPostcode`).
3. A sales channel ID for this integration, from Settings > API > Channel options (`channelId`).
4. Install the plugin:

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
        pollIntervalMinutes: 15, // how often to check Shiprocket for status changes
      }),
    ]
    ```
    For all the plugin options, see the `ShiprocketPluginOptions` type.
2. Create a new ShippingMethod in the Admin UI:
   - Calculator: "Shiprocket live shipping rate" (`shiprocket-live-rate`) - fill in its arguments
     with the Shiprocket account to use for this method: `email`, `password`, `pickupLocation`,
     `channelId`, `pickupPostcode`, and optionally `defaultCourierId`, plus `flatRateFallback` and
     `taxRate`. Since these credentials live on the ShippingMethod (which is assignable to specific
     channels), different ShippingMethods - and therefore different channels - can point at
     different Shiprocket accounts.
   - Fulfillment handler: "Ship via Shiprocket" (`shiprocket`)

## Storefront Usage

This plugin only adds a shipping calculator and fulfillment handler - the storefront uses Vendure's
standard shipping-method APIs, no Shiprocket-specific queries or mutations are required.

1. Once the order has a shipping address, call `eligibleShippingMethods` to get the quoted price:
   ```graphql
   query {
     eligibleShippingMethods {
       id
       name
       price
       priceWithTax
     }
   }
   ```
   For the ShippingMethod using the "Shiprocket live shipping rate" calculator, `price`/`priceWithTax`
   reflects a live rate from Shiprocket's serviceability API for the order's destination postcode. If
   that lookup fails or returns no serviceable couriers, the calculator falls back to the flat rate
   configured on the ShippingMethod (its `flatRateFallback` argument) - checkout is never blocked by a
   Shiprocket outage.
2. Set the chosen method on the order as usual:
   ```graphql
   mutation {
     setOrderShippingMethod(shippingMethodId: "<id>") {
       ... on Order {
         id
         shippingWithTax
       }
     }
   }
   ```

## Admin Usage

When an order is fulfilled via the "Ship via Shiprocket" handler, the plugin:

1. Creates the shipment in Shiprocket.
2. Assigns a courier and generates an AWB code, restricted to `defaultCourierId` if one is
   configured, or Shiprocket's recommended courier otherwise. This step is required to succeed -
   fulfillment creation fails if no courier can be assigned, so a shipment is never left stuck
   without an AWB.
3. Requests pickup for the shipment. This step is best-effort: if it fails or doesn't confirm
   immediately, a warning is logged and the pickup can be scheduled manually from the Shiprocket
   dashboard - it does not fail the fulfillment, since the shipment and AWB already exist.

The resulting `shiprocketShipmentId`, `shiprocketAwbCode`, and `shiprocketCourierName` are stored as
Fulfillment custom fields.

## Status Sync

Shiprocket webhook delivery must be configured per-channel in their dashboard and is not
provisionable via API, so this plugin polls the Track/Shipment-status API instead, via a recurring
Vendure job queue task (`shiprocket-status-sync`, visible in the Admin UI under Job Queue). By
default this runs every 15 minutes; configure via `pollIntervalMinutes`. Fulfillments transition
`Pending -> Shipped -> Delivered`, or to `Cancelled` on RTO/cancellation, based on the tracked
status. Failures are logged and retried on the next cycle.

## Local Development

Set `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_CHANNEL_ID`,
and `SHIPROCKET_PICKUP_POSTCODE` in a `.env` file in this package (these seed the calculator
arguments of a ShippingMethod created automatically by the dev server), then run:

```shell
npm run dev-server
```
