import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    LoginEvent,
    LogoutEvent,
    Product,
    ProductChannelEvent,
    ProductVariantChannelEvent,
    RequestContext,
} from '@vendure/core';

import { AuditLogPlugin } from '../audit-log.plugin';
import { AUDIT_ACTIONS } from '../constants/audit-actions';
import { AuditActorResolverService, ResolvedActor } from '../services/audit-actor-resolver.service';
import { AuditDiffService } from '../services/audit-diff.service';
import { AuditLogService } from '../services/audit-log.service';
import { AuditRequestContextStore } from '../services/audit-request-context-store';
import { AuditSettingsService } from '../services/audit-settings.service';
import { RecordAuditInput } from '../types/audit.types';

import { actionFor, entityLabel, ENTITY_EVENT_MAPPINGS, flattenTranslation } from './entity-type-map';

@Injectable()
export class AuditSubscribersService implements OnApplicationBootstrap {
    constructor(
        private eventBus: EventBus,
        private auditLogService: AuditLogService,
        private actorResolver: AuditActorResolverService,
        private diffService: AuditDiffService,
        private requestContextStore: AuditRequestContextStore,
        private settingsService: AuditSettingsService,
    ) {}

    onApplicationBootstrap() {
        if (!AuditLogPlugin.options.enabled) {
            return;
        }
        for (const mapping of ENTITY_EVENT_MAPPINGS) {
            this.eventBus.ofType(mapping.eventType).subscribe(event => {
                const changes =
                    event.type === 'deleted'
                        ? undefined
                        : this.diffService.diff(undefined, flattenTranslation(event.entity) as any);
                void this.record(event.ctx, {
                    action: actionFor(mapping.entityType, event.type),
                    eventType: mapping.eventType.name,
                    entityType: mapping.entityType,
                    entityId: String((event.entity)?.id ?? ''),
                    entityName: entityLabel(event.entity, mapping.nameFields),
                    changes: changes ?? null,
                    success: true,
                });
            });
        }

        this.eventBus.ofType(ProductChannelEvent).subscribe(event => {
            void this.record(event.ctx, {
                action:
                    event.type === 'assigned'
                        ? AUDIT_ACTIONS.PRODUCT_ADDED_TO_CHANNEL
                        : AUDIT_ACTIONS.PRODUCT_REMOVED_FROM_CHANNEL,
                eventType: 'ProductChannelEvent',
                entityType: 'PRODUCT',
                entityId: String(event.product.id),
                entityName: (event.product).name,
                channelId: String(event.channelId),
                success: true,
            });
        });

        this.eventBus.ofType(ProductVariantChannelEvent).subscribe(event => {
            void this.record(event.ctx, {
                action:
                    event.type === 'assigned'
                        ? AUDIT_ACTIONS.PRODUCT_VARIANT_ADDED_TO_CHANNEL
                        : AUDIT_ACTIONS.PRODUCT_VARIANT_REMOVED_FROM_CHANNEL,
                eventType: 'ProductVariantChannelEvent',
                entityType: 'PRODUCT_VARIANT',
                entityId: String(event.productVariant.id),
                entityName: entityLabel(event.productVariant, ['name', 'sku']),
                channelId: String(event.channelId),
                success: true,
            });
        });

        this.eventBus.ofType(LoginEvent).subscribe(event => {
            // ctx.session.user isn't populated yet at LoginEvent time (the session is
            // still being established), so the generic actor resolver would report
            // SYSTEM here. event.user is already the authenticated user — use it directly.
            void this.record(event.ctx, {
                action: AUDIT_ACTIONS.LOGIN_SUCCESS,
                eventType: 'LoginEvent',
                entityType: 'ADMINISTRATOR',
                entityId: String(event.user.id),
                entityName: event.user.identifier,
                success: true,
                actorOverride: {
                    actorType: 'ADMINISTRATOR',
                    actorId: String(event.user.id),
                    actorIdentifier: event.user.identifier,
                    actorEmail: event.user.identifier.includes('@') ? event.user.identifier : undefined,
                },
            });
        });

        this.eventBus.ofType(LogoutEvent).subscribe(event => {
            void this.record(event.ctx, {
                action: AUDIT_ACTIONS.LOGOUT,
                eventType: 'LogoutEvent',
                entityType: 'ADMINISTRATOR',
                success: true,
            });
        });
    }

    private async record(
        ctx: RequestContext,
        partial: Omit<RecordAuditInput, 'actorType' | 'source'> & { actorOverride?: ResolvedActor },
    ) {
        if (ctx.apiType !== 'admin') {
            return;
        }
        const { actorOverride, ...rest } = partial;
        const actor = actorOverride ?? this.actorResolver.resolve(ctx);
        const requestMeta = this.requestContextStore.get();
        const settings = this.settingsService.getSnapshot();
        await this.auditLogService.record({
            channelId: String(ctx.channel.id),
            channelCode: ctx.channel.code,
            channelName: ctx.channel.description || ctx.channel.code,
            ...rest,
            ...actor,
            source: 'EVENT_BUS',
            requestId: requestMeta?.requestId,
            ipAddress: settings.captureIpAddress ? (requestMeta?.ipAddress ?? ctx.req?.ip) : undefined,
            userAgent: settings.captureUserAgent
                ? (requestMeta?.userAgent ?? ctx.req?.get?.('user-agent') ?? undefined)
                : undefined,
        });
    }
}
