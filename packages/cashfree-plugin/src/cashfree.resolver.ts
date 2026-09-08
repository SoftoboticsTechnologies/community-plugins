import { Mutation, Resolver } from '@nestjs/graphql';
import { ActiveOrderService, Allow, Ctx, Permission, RequestContext, UnauthorizedError, UserInputError } from '@vendure/core';

import { CashfreeOrderResult, CashfreeService } from './cashfree.service';

@Resolver()
export class CashfreeResolver {
    constructor(
        private cashfreeService: CashfreeService,
        private activeOrderService: ActiveOrderService,
    ) {}

    @Mutation()
    @Allow(Permission.Owner)
    async createCashfreeOrder(@Ctx() ctx: RequestContext): Promise<CashfreeOrderResult> {
        if (!ctx.authorizedAsOwnerOnly) {
            throw new UnauthorizedError();
        }
        const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!sessionOrder) {
            throw new UserInputError('No active order found for session');
        }
        return this.cashfreeService.createOrder(ctx, sessionOrder);
    }
}
