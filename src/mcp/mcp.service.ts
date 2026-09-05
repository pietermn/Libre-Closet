import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  ForbiddenException,
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpAuditLog } from '../dal/entity/mcp-audit-log.entity';
import { McpAuthorizationCode } from '../dal/entity/mcp-authorization-code.entity';
import { McpOAuthClient } from '../dal/entity/mcp-oauth-client.entity';
import { McpToken, McpTokenType } from '../dal/entity/mcp-token.entity';
import { User } from '../dal/entity/user.entity';

export const MCP_SCOPES = [
  'closet:read',
  'closet:write',
  'outfits:read',
  'outfits:write',
  'calendar:read',
  'calendar:write',
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpIdentity {
  userId: number;
  clientId: number;
  tokenId: number;
  scopes: McpScope[];
}

@Injectable()
export class McpService {
  private readonly requests = new Map<string, number[]>();

  constructor(
    @InjectRepository(McpOAuthClient)
    private readonly clientRepository: EntityRepository<McpOAuthClient>,
    @InjectRepository(McpAuthorizationCode)
    private readonly codeRepository: EntityRepository<McpAuthorizationCode>,
    @InjectRepository(McpToken)
    private readonly tokenRepository: EntityRepository<McpToken>,
    @InjectRepository(McpAuditLog)
    private readonly auditRepository: EntityRepository<McpAuditLog>,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private readonly em: EntityManager,
    private readonly config: ConfigService,
  ) {}

  resourceUrl(): string {
    return `${this.config.getOrThrow<string>('SITE_URL').replace(/\/$/, '')}/mcp`;
  }

  issuerUrl(): string {
    return this.config.getOrThrow<string>('SITE_URL').replace(/\/$/, '');
  }

  async registerClient(input: {
    client_name?: string;
    redirect_uris?: unknown;
  }): Promise<McpOAuthClient> {
    const redirectUris = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
      : [];
    if (!redirectUris.length || !redirectUris.every((uri) => this.validRedirectUri(uri))) {
      throw new ForbiddenException('Valid HTTPS redirect_uris are required');
    }
    const client = this.clientRepository.create({
      clientId: `mcp_${randomBytes(24).toString('base64url')}`,
      name: String(input.client_name || 'MCP client').slice(0, 120),
      redirectUris,
    });
    await this.em.persistAndFlush(client);
    return client;
  }

  async authorizationRequest(input: {
    clientId: string;
    redirectUri: string;
    responseType: string;
    codeChallenge: string;
    codeChallengeMethod?: string;
    scope?: string;
    resource: string;
  }): Promise<{ client: McpOAuthClient; scopes: McpScope[] }> {
    if (input.responseType !== 'code' || input.codeChallengeMethod !== 'S256') {
      throw new ForbiddenException('Authorization code flow with S256 PKCE is required');
    }
    if (input.resource !== this.resourceUrl()) {
      throw new ForbiddenException('Invalid MCP resource');
    }
    const client = await this.clientRepository.findOne({ clientId: input.clientId });
    if (!client || !client.redirectUris.includes(input.redirectUri)) {
      throw new ForbiddenException('Unknown client or redirect URI');
    }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
      throw new ForbiddenException('Invalid PKCE code challenge');
    }
    const requested = (input.scope || '').split(' ').filter(Boolean);
    const scopes = requested.length ? requested : [...MCP_SCOPES];
    if (!scopes.every((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope))) {
      throw new ForbiddenException('Unknown scope');
    }
    return { client, scopes };
  }

  async grantAuthorization(input: {
    userId: number;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: McpScope[];
    resource: string;
  }): Promise<string> {
    const { client } = await this.authorizationRequest({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      responseType: 'code',
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      scope: input.scopes.join(' '),
      resource: input.resource,
    });
    const user = await this.userRepository.findOneOrFail(input.userId);
    const rawCode = randomBytes(32).toString('base64url');
    const code = this.codeRepository.create({
      codeHash: this.hash(rawCode),
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      client,
      user,
    });
    await this.em.persistAndFlush(code);
    return rawCode;
  }

  async exchangeCode(input: {
    clientId: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
  }) {
    const code = await this.codeRepository.findOne(
      { codeHash: this.hash(input.code) },
      { populate: ['client', 'user'] },
    );
    if (
      !code ||
      code.consumedAt ||
      code.expiresAt.getTime() <= Date.now() ||
      code.client.unwrap().clientId !== input.clientId ||
      code.redirectUri !== input.redirectUri ||
      code.resource !== input.resource ||
      input.resource !== this.resourceUrl() ||
      this.pkceChallenge(input.codeVerifier) !== code.codeChallenge
    ) {
      throw new UnauthorizedException('Invalid or expired authorization code');
    }
    code.consumedAt = new Date();
    const tokens = await this.issueTokens(code.user.unwrap(), code.client.unwrap(), code.scopes as McpScope[], code.resource);
    await this.em.persistAndFlush(code);
    return tokens;
  }

  async refreshToken(input: { clientId: string; refreshToken: string; resource: string }) {
    const token = await this.tokenRepository.findOne(
      { tokenHash: this.hash(input.refreshToken), type: McpTokenType.REFRESH },
      { populate: ['client', 'user'] },
    );
    if (
      !token || token.revokedAt || token.expiresAt.getTime() <= Date.now() ||
      token.client.unwrap().clientId !== input.clientId || token.resource !== input.resource ||
      input.resource !== this.resourceUrl()
    ) throw new UnauthorizedException('Invalid refresh token');
    token.revokedAt = new Date();
    const replacement = await this.issueTokens(token.user.unwrap(), token.client.unwrap(), token.scopes as McpScope[], token.resource);
    await this.em.persistAndFlush(token);
    return replacement;
  }

  async authenticate(accessToken: string, requiredScopes: McpScope[] = []): Promise<McpIdentity> {
    const token = await this.tokenRepository.findOne(
      { tokenHash: this.hash(accessToken), type: McpTokenType.ACCESS },
      { populate: ['client', 'user'] },
    );
    if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now() || token.resource !== this.resourceUrl()) {
      throw new UnauthorizedException('Invalid MCP access token');
    }
    const scopes = token.scopes as McpScope[];
    if (!requiredScopes.every((scope) => scopes.includes(scope))) {
      throw new ForbiddenException('Insufficient MCP scope');
    }
    return { userId: token.user.unwrap().id, clientId: token.client.unwrap().id, tokenId: token.id, scopes };
  }

  consumeRateLimit(identity: McpIdentity, write: boolean): void {
    const now = Date.now();
    const key = `${identity.tokenId}:${write ? 'write' : 'read'}`;
    const limit = write ? 20 : 60;
    const recent = (this.requests.get(key) ?? []).filter((time) => time > now - 60_000);
    if (recent.length >= limit) throw new HttpException('MCP rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.requests.set(key, recent);
  }

  async audit(identity: McpIdentity, tool: string, outcome: McpAuditLog['outcome']): Promise<void> {
    const user = await this.userRepository.getReference(identity.userId);
    const client = await this.clientRepository.getReference(identity.clientId);
    const event = this.auditRepository.create({ tool, outcome, user, client });
    await this.em.persistAndFlush(event);
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.em.nativeUpdate(McpToken, { user: userId, revokedAt: null }, { revokedAt: new Date() });
  }

  async listConnections(userId: number) {
    const tokens = await this.tokenRepository.find(
      { user: userId, type: McpTokenType.REFRESH, revokedAt: null, expiresAt: { $gt: new Date() } },
      { populate: ['client'], orderBy: { createdAt: 'DESC' } },
    );
    return tokens.map((token) => ({
      clientId: token.client.unwrap().id,
      name: token.client.unwrap().name,
      scopes: token.scopes as McpScope[],
      connectedAt: token.createdAt,
      expiresAt: token.expiresAt,
    }));
  }

  async revokeClientForUser(userId: number, clientId: number): Promise<void> {
    await this.em.nativeUpdate(
      McpToken,
      { user: userId, client: clientId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  private async issueTokens(user: User, client: McpOAuthClient, scopes: McpScope[], resource: string) {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(48).toString('base64url');
    const access = this.tokenRepository.create({ tokenHash: this.hash(accessToken), type: McpTokenType.ACCESS, scopes, resource, expiresAt: new Date(Date.now() + 60 * 60 * 1000), user, client });
    const refresh = this.tokenRepository.create({ tokenHash: this.hash(refreshToken), type: McpTokenType.REFRESH, scopes, resource, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), user, client });
    await this.em.persistAndFlush([access, refresh]);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: scopes.join(' ') };
  }

  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  private pkceChallenge(verifier: string): string { return createHash('sha256').update(verifier).digest('base64url'); }
  private validRedirectUri(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname));
    } catch { return false; }
  }
}
