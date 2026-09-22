import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { RequestAuditMeta } from '../types/audit.types';

const storage = new AsyncLocalStorage<RequestAuditMeta>();

/**
 * Correlates Admin API request metadata (requestId, IP, user agent, operation name)
 * to EventBus events fired during that request's execution. EventBus handlers run
 * within the same async context as the mutation that dispatched them, so this store
 * lets a subscriber pick up metadata the event payload itself doesn't carry.
 */
@Injectable()
export class AuditRequestContextStore {
    run<T>(meta: RequestAuditMeta, fn: () => T): T {
        return storage.run(meta, fn);
    }

    get(): RequestAuditMeta | undefined {
        return storage.getStore();
    }
}
