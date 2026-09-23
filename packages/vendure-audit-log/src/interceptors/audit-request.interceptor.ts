import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { AuditRequestContextStore } from '../services/audit-request-context-store';

/** Accepts a client-supplied request id only if it's a short, safe token — anything else (including
 * control characters that could forge extra log lines) falls back to a freshly generated UUID. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Populates AuditRequestContextStore with per-request metadata for the duration of the
 * request. EventBus handlers fired synchronously within a mutation resolver's call stack
 * inherit this AsyncLocalStorage context and can read it back via `.get()`.
 */
@Injectable()
export class AuditRequestInterceptor implements NestInterceptor {
    constructor(private requestContextStore: AuditRequestContextStore) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const gqlCtx = GqlExecutionContext.create(context);
        const req = gqlCtx.getContext()?.req ?? context.switchToHttp().getRequest();
        if (!req) {
            return next.handle();
        }
        const info = gqlCtx.getInfo?.();
        const rawRequestId = req.headers?.['x-request-id'] as string | undefined;
        const meta = {
            requestId: rawRequestId && SAFE_REQUEST_ID.test(rawRequestId) ? rawRequestId : randomUUID(),
            ipAddress: req.ip,
            userAgent: req.get ? req.get('user-agent') : req.headers?.['user-agent'],
            operationName: info?.fieldName,
        };
        return new Observable(subscriber => {
            this.requestContextStore.run(meta, () => {
                next.handle().subscribe(subscriber);
            });
        });
    }
}
