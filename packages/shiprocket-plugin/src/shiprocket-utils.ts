/**
 * @description
 * Maps a free-text Shiprocket tracking status label (e.g. a `sr-status-label` from
 * `shipment_track_activities`) onto the next Fulfillment state to
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
    if (
        currentState === 'Pending' &&
        (status.includes('in transit') ||
            status.includes('shipped') ||
            status.includes('picked up') ||
            status.includes('delivered'))
    ) {
        return 'Shipped';
    }
    if (currentState === 'Shipped' && status.includes('delivered')) {
        return 'Delivered';
    }
    return undefined;
}
