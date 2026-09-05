import type { Opt } from '@mikro-orm/core';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  type Ref,
} from '@mikro-orm/core';
import { McpOAuthClient } from './mcp-oauth-client.entity';
import { User } from './user.entity';

/** Minimal, non-sensitive audit trail for every MCP tool invocation. */
@Entity()
export class McpAuditLog {
  @PrimaryKey()
  public id!: number;

  @Property()
  public tool!: string;

  @Property()
  public outcome!: 'success' | 'denied' | 'error' | 'rate_limited';

  @Property()
  public createdAt: Date & Opt = new Date();

  @ManyToOne({ entity: () => User, deleteRule: 'cascade', ref: true })
  public user!: Ref<User>;

  @ManyToOne({
    entity: () => McpOAuthClient,
    deleteRule: 'set null',
    ref: true,
    nullable: true,
  })
  public client?: Ref<McpOAuthClient>;
}
