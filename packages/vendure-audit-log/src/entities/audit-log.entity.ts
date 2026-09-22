import { VendureEntity } from '@vendure/core';
import { Column, CreateDateColumn, Entity, Index } from 'typeorm';
import { ActorType, AuditChanges, AuditSource } from '../types/audit.types';

@Entity('audit_log')
@Index(['createdAt'])
@Index(['actorId'])
@Index(['actorType'])
@Index(['action'])
@Index(['eventType'])
@Index(['entityType'])
@Index(['entityId'])
@Index(['channelId'])
export class AuditLog extends VendureEntity {
    constructor(input?: Partial<AuditLog>) {
        super(input);
    }

    @CreateDateColumn()
    createdAt: Date;

    @Column({ type: 'varchar' })
    actorType: ActorType;

    @Column({ type: 'varchar', nullable: true })
    actorId: string | null;

    @Column({ type: 'varchar', nullable: true })
    actorIdentifier: string | null;

    @Column({ type: 'varchar', nullable: true })
    actorEmail: string | null;

    @Column({ type: 'varchar' })
    action: string;

    @Column({ type: 'varchar' })
    eventType: string;

    @Column({ type: 'varchar' })
    entityType: string;

    @Column({ type: 'varchar', nullable: true })
    entityId: string | null;

    @Column({ type: 'varchar', nullable: true })
    entityName: string | null;

    @Column({ type: 'varchar', nullable: true })
    channelId: string | null;

    @Column({ type: 'varchar', nullable: true })
    channelCode: string | null;

    @Column({ type: 'varchar', nullable: true })
    channelName: string | null;

    @Column({ type: 'simple-json', nullable: true })
    changes: AuditChanges | null;

    @Column({ type: 'simple-json', nullable: true })
    metadata: Record<string, unknown> | null;

    @Column({ type: 'varchar', nullable: true })
    requestId: string | null;

    @Column({ type: 'varchar', nullable: true })
    ipAddress: string | null;

    @Column({ type: 'varchar', nullable: true })
    userAgent: string | null;

    @Column({ type: 'boolean', default: true })
    success: boolean;

    @Column({ type: 'text', nullable: true })
    error: string | null;

    @Column({ type: 'varchar' })
    source: AuditSource;
}
