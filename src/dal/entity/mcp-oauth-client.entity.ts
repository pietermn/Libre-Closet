import {
  Collection,
  Entity,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { McpAuthorizationCode } from './mcp-authorization-code.entity';
import { McpToken } from './mcp-token.entity';

/**
 * A public OAuth client registered by an MCP host (for example Codex).
 * Client secrets are intentionally not supported: every code exchange uses PKCE.
 */
@Entity()
export class McpOAuthClient {
  @PrimaryKey()
  public id!: number;

  @Property({ unique: true })
  public clientId!: string;

  @Property()
  public name!: string;

  @Property({ type: 'json' })
  public redirectUris!: string[];

  @Property()
  public createdAt = new Date();

  @OneToMany(() => McpAuthorizationCode, (code) => code.client)
  public authorizationCodes = new Collection<McpAuthorizationCode>(this);

  @OneToMany(() => McpToken, (token) => token.client)
  public tokens = new Collection<McpToken>(this);
}
