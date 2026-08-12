import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  type Ref,
} from '@mikro-orm/core';
import { McpOAuthClient } from './mcp-oauth-client.entity';
import { User } from './user.entity';

/** Short-lived, single-use OAuth authorization code. */
@Entity()
export class McpAuthorizationCode {
  @PrimaryKey()
  public id!: number;

  @Property({ unique: true })
  public codeHash!: string;

  @Property()
  public redirectUri!: string;

  @Property()
  public codeChallenge!: string;

  @Property({ type: 'json' })
  public scopes!: string[];

  @Property()
  public resource!: string;

  @Property()
  public expiresAt!: Date;

  @Property({ nullable: true })
  public consumedAt?: Date;

  @ManyToOne({ entity: () => McpOAuthClient, deleteRule: 'cascade', ref: true })
  public client!: Ref<McpOAuthClient>;

  @ManyToOne({ entity: () => User, deleteRule: 'cascade', ref: true })
  public user!: Ref<User>;
}
