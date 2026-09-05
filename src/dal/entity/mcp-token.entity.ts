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

export enum McpTokenType {
  ACCESS = 'access',
  REFRESH = 'refresh',
}

/** Opaque MCP OAuth token; only its SHA-256 hash is persisted. */
@Entity()
export class McpToken {
  @PrimaryKey()
  public id!: number;

  @Property({ unique: true })
  public tokenHash!: string;

  @Property()
  public type!: McpTokenType;

  @Property({ type: 'json' })
  public scopes!: string[];

  @Property()
  public resource!: string;

  @Property()
  public expiresAt!: Date;

  @Property({ nullable: true })
  public revokedAt?: Date;

  @Property()
  public createdAt: Date & Opt = new Date();

  @ManyToOne({ entity: () => McpOAuthClient, deleteRule: 'cascade', ref: true })
  public client!: Ref<McpOAuthClient>;

  @ManyToOne({ entity: () => User, deleteRule: 'cascade', ref: true })
  public user!: Ref<User>;
}
