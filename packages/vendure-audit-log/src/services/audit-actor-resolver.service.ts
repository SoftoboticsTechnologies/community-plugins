import { Injectable } from '@nestjs/common';
import { RequestContext } from '@vendure/core';
import { ActorType } from '../types/audit.types';

export interface ResolvedActor {
    actorType: ActorType;
    actorId?: string;
    actorIdentifier?: string;
    actorEmail?: string;
}

@Injectable()
export class AuditActorResolverService {
    resolve(ctx: RequestContext): ResolvedActor {
        const user = ctx.session?.user;
        if (!user) {
            return { actorType: 'SYSTEM' };
        }
        const actorType: ActorType =
            ctx.session?.authenticationStrategy === 'api-key' ? 'API_KEY' : 'ADMINISTRATOR';
        return {
            actorType,
            actorId: String(user.id),
            actorIdentifier: user.identifier,
            actorEmail: user.identifier.includes('@') ? user.identifier : undefined,
        };
    }
}
