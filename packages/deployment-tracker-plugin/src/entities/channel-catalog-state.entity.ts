import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { DeployStatus } from '../types';

@Entity()
export class ChannelCatalogState extends VendureEntity {
    constructor(input?: DeepPartial<ChannelCatalogState>) {
        super(input);
    }

    @Index({ unique: true })
    @EntityId()
    channelId: ID;

    @Column()
    lastChangedAt: Date;

    @Column()
    changedByEntityType: string;

    @Column({ nullable: true })
    lastPublishTriggeredAt?: Date;

    @Column({ type: 'varchar', default: 'idle' })
    deployStatus: DeployStatus;
}
