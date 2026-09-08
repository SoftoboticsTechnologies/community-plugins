import Razorpay from 'razorpay';

/**
 * Wrapper around the Razorpay SDK client that exposes the ApiSecret and WebhookSecret alongside
 * the SDK instance, mirroring `stripe-plugin`'s `VendureStripeClient` pattern.
 */
export class VendureRazorpayClient {
    readonly instance: Razorpay;

    constructor(
        public apiKey: string,
        public apiSecret: string,
        public webhookSecret: string = '',
    ) {
        this.instance = new Razorpay({ key_id: apiKey, key_secret: apiSecret });
    }
}
