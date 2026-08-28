/**
 * @description
 * Maps a free-text Shiprocket `shipment_status` string onto the next Fulfillment state to
 * transition to, or `undefined` if there's nothing to do. Vendure's default Fulfillment state
 * machine only allows `Pending -> Shipped -> Delivered` (plus `Cancelled` from either), so this
 * only ever proposes the single next step - it does not try to skip states.
 */
export function mapShiprocketStatusToFulfillmentState(
    shiprocketStatus: string,
    currentState: string,
): 'Shipped' | 'Delivered' | 'Cancelled' | undefined {
    const status = shiprocketStatus.toLowerCase();

    if (status.includes('rto') || status.includes('cancel')) {
        return currentState === 'Cancelled' ? undefined : 'Cancelled';
    }
    if (status.includes('delivered')) {
        return currentState === 'Delivered' ? undefined : 'Delivered';
    }
    if (currentState === 'Pending' && (status.includes('in transit') || status.includes('shipped') || status.includes('picked up'))) {
        return 'Shipped';
    }
    return undefined;
}
