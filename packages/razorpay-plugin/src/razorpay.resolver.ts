import { Mutation, Resolver } from '@nestjs/graphql';
import { ActiveOrderService, Allow, Ctx, Permission, RequestContext, UnauthorizedError, UserInputError } from '@vendure/core';

import { RazorpayOrderResult, RazorpayService } from './razorpay.service';

@Resolver()
export class RazorpayResolver {
    constructor(
        private razorpayService: RazorpayService,
        private activeOrderService: ActiveOrderService,
    ) {}

    @Mutation()
    @Allow(Permission.Owner)
    async createRazorpayOrder(@Ctx() ctx: RequestContext): Promise<RazorpayOrderResult> {
        if (!ctx.authorizedAsOwnerOnly) {
            throw new UnauthorizedError();
        }
        const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!sessionOrder) {
            throw new UserInputError('No active order found for session');
        }
        return this.razorpayService.createOrder(ctx, sessionOrder);
    }
}
