import {
  Body,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConditionalAuthGuard } from '../auth/conditional-auth.guard';
import { Payload } from '../auth/dto/payload.dto';
import { User } from '../auth/user.decorator';
import { FileService } from '../file/file-service.abstract';
import { RemoteImageService, readPhotoBytes } from './remote-image.service';
import { CreateGarmentDto } from '../wardrobe/dto/create-garment.dto';
import { UpdateGarmentDto } from '../wardrobe/dto/update-garment.dto';
import { CalendarService } from '../wardrobe/calendar.service';
import { GarmentService } from '../wardrobe/garment.service';
import { OutfitService } from '../wardrobe/outfit.service';
import { McpIdentity, McpScope, McpService, MCP_SCOPES } from './mcp.service';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

@Controller()
export class McpMetadataController {
  constructor(private readonly mcp: McpService) {}

  @Get('.well-known/oauth-protected-resource')
  protectedResource() {
    return {
      resource: this.mcp.resourceUrl(),
      authorization_servers: [this.mcp.issuerUrl()],
      scopes_supported: MCP_SCOPES,
      resource_documentation: `${this.mcp.issuerUrl()}/auth/profile`,
    };
  }

  @Get('.well-known/oauth-authorization-server')
  authorizationServer() {
    const base = this.mcp.issuerUrl();
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: MCP_SCOPES,
    };
  }
}

@Controller('oauth')
export class McpOAuthController {
  constructor(private readonly mcp: McpService) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: { client_name?: string; redirect_uris?: unknown },
  ) {
    const client = await this.mcp.registerClient(body);
    return {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
    };
  }

  @Get('authorize')
  @UseGuards(ConditionalAuthGuard)
  async authorize(
    @Query() query: Record<string, string | undefined>,
    @User() user: Payload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const request = await this.mcp.authorizationRequest({
      clientId: query.client_id ?? '',
      redirectUri: query.redirect_uri ?? '',
      responseType: query.response_type ?? '',
      codeChallenge: query.code_challenge ?? '',
      codeChallengeMethod: query.code_challenge_method,
      scope: query.scope,
      resource: query.resource ?? '',
    });
    return reply.view('auth/mcp-authorize', {
      client: request.client,
      scopes: request.scopes,
      request: query,
      userEmail: user.email,
    });
  }

  @Post('authorize')
  @UseGuards(ConditionalAuthGuard)
  async approve(
    @Body() body: Record<string, string | undefined>,
    @User() user: Payload,
    @Res() reply: FastifyReply,
  ) {
    if (body.approve !== 'true')
      throw new UnauthorizedException('Authorization was denied');
    const request = await this.mcp.authorizationRequest({
      clientId: body.client_id ?? '',
      redirectUri: body.redirect_uri ?? '',
      responseType: body.response_type ?? '',
      codeChallenge: body.code_challenge ?? '',
      codeChallengeMethod: body.code_challenge_method,
      scope: body.scope,
      resource: body.resource ?? '',
    });
    const code = await this.mcp.grantAuthorization({
      userId: Number(user.userId),
      clientId: request.client.clientId,
      redirectUri: body.redirect_uri!,
      codeChallenge: body.code_challenge!,
      scopes: request.scopes,
      resource: body.resource!,
    });
    const url = new URL(body.redirect_uri!);
    url.searchParams.set('code', code);
    if (body.state) url.searchParams.set('state', body.state);
    return reply.redirect(url.toString(), 302);
  }

  @Post('token')
  @HttpCode(200)
  async token(@Body() body: Record<string, string | undefined>) {
    if (body.grant_type === 'authorization_code') {
      return this.mcp.exchangeCode({
        clientId: body.client_id ?? '',
        code: body.code ?? '',
        redirectUri: body.redirect_uri ?? '',
        codeVerifier: body.code_verifier ?? '',
        resource: body.resource ?? '',
      });
    }
    if (body.grant_type === 'refresh_token') {
      return this.mcp.refreshToken({
        clientId: body.client_id ?? '',
        refreshToken: body.refresh_token ?? '',
        resource: body.resource ?? '',
      });
    }
    throw new UnauthorizedException('Unsupported grant_type');
  }
}

@Controller('auth/mcp')
@UseGuards(ConditionalAuthGuard)
export class McpConnectionController {
  constructor(private readonly mcp: McpService) {}

  @Get()
  async connections(@User() user: Payload, @Res() reply: FastifyReply) {
    return reply.view('auth/mcp-connections', {
      connections: await this.mcp.listConnections(Number(user.userId)),
      mcpUrl: this.mcp.resourceUrl(),
    });
  }

  @Post(':clientId/revoke')
  async revoke(
    @User() user: Payload,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const clientId = Number((req.params as { clientId: string }).clientId);
    await this.mcp.revokeClientForUser(Number(user.userId), clientId);
    return reply.redirect('/auth/mcp', 302);
  }
}

@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly garments: GarmentService,
    private readonly outfits: OutfitService,
    private readonly calendar: CalendarService,
    private readonly remoteImages: RemoteImageService,
    private readonly files: FileService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Body() message: JsonRpcRequest,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const id = message.id ?? null;
    if (message.jsonrpc !== '2.0' || !message.method)
      return reply
        .code(400)
        .send(this.error(id, -32600, 'Invalid JSON-RPC request'));
    if (message.method === 'initialize')
      return this.result(id, {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'libre-closet', version: '0.1.0' },
        instructions:
          'All results are private to the linked Libre-Closet account. Confirm an item before updating it.',
      });
    if (message.method === 'notifications/initialized')
      return reply.code(202).send();
    if (message.method === 'ping') return this.result(id, {});
    const identity = await this.identity(authorization, reply);
    if (!identity) return;
    if (message.method === 'tools/list')
      return this.result(id, { tools: this.tools() });
    if (message.method !== 'tools/call')
      return this.error(id, -32601, 'Method not found');
    const name = String(message.params?.name ?? '');
    const args = message.params?.arguments ?? {};
    try {
      const output = await this.callTool(identity, name, args);
      await this.mcp.audit(identity, name, 'success');
      if ('image' in output)
        return this.result(id, {
          content: [output.image],
          structuredContent: { garmentId: output.garmentId },
        });
      return this.result(id, {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      });
    } catch (error: any) {
      const rateLimited = error?.status === 429;
      await this.mcp.audit(
        identity,
        name,
        rateLimited
          ? 'rate_limited'
          : error?.status === 403
            ? 'denied'
            : 'error',
      );
      return this.result(id, {
        content: [{ type: 'text', text: error?.message ?? 'Tool failed' }],
        isError: true,
      });
    }
  }

  @Get()
  getNotSupported(@Res() reply: FastifyReply) {
    return reply
      .code(405)
      .send({ error: 'Use POST for MCP Streamable HTTP requests' });
  }

  private async identity(
    header: string | undefined,
    reply: FastifyReply,
  ): Promise<McpIdentity | undefined> {
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      reply
        .code(401)
        .header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${this.mcp.issuerUrl()}/.well-known/oauth-protected-resource"`,
        )
        .send({ error: 'MCP authorization required' });
      return undefined;
    }
    try {
      return await this.mcp.authenticate(token);
    } catch {
      reply
        .code(401)
        .header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${this.mcp.issuerUrl()}/.well-known/oauth-protected-resource", error="invalid_token"`,
        )
        .send({ error: 'Invalid MCP token' });
      return undefined;
    }
  }

  private async callTool(
    identity: McpIdentity,
    name: string,
    args: Record<string, any>,
  ) {
    const write = [
      'create_garment',
      'update_garment',
      'create_outfit',
      'update_outfit',
      'schedule_outfit',
    ].includes(name);
    const scope = this.toolScope(name);
    if (!scope) throw new ForbiddenException('Unknown MCP tool');
    if (!identity.scopes.includes(scope))
      throw new ForbiddenException(`Missing scope ${scope}`);
    this.mcp.consumeRateLimit(identity, write);
    const userId = identity.userId;
    if (name === 'list_garments' || name === 'search_garments') {
      const filters = this.searchInput(args);
      const limit = this.pageNumber(args.limit, 25, 1, 100);
      const offset = this.pageNumber(args.offset, 0, 0, 1_000_000);
      const { garments, total } = await this.garments.findPage(
        userId,
        filters,
        limit,
        offset,
      );
      return {
        garments: garments.map((g) => this.garment(g)),
        total,
        limit,
        offset,
        nextOffset:
          offset + garments.length < total ? offset + garments.length : null,
      };
    }
    if (name === 'get_garment')
      return {
        garment: this.garment(
          await this.garments.findOne(this.garmentId(args.id), userId),
        ),
      };
    if (name === 'get_garment_photo') {
      const garment = await this.garments.findOne(
        this.garmentId(args.id),
        userId,
      );
      if (!garment.photo)
        throw new NotFoundException('This garment has no photo');
      const stream =
        (await this.files.getNobgVariant(garment.photo.fileName)) ??
        (await this.files.get(garment.photo.fileName));
      if (!stream) throw new NotFoundException('Photo unavailable');
      const buffer = await readPhotoBytes(stream);
      return {
        garmentId: garment.id,
        image: {
          type: 'image',
          mimeType: 'image/webp',
          data: buffer.toString('base64'),
        },
      };
    }
    if (name === 'list_outfits')
      return {
        outfits: (await this.outfits.findAll(userId))
          .slice(0, 100)
          .map((o) => this.outfit(o)),
      };
    if (name === 'get_outfit')
      return {
        outfit: this.outfit(
          await this.outfits.findOne(Number(args.id), userId),
        ),
      };
    if (name === 'get_calendar') {
      const week = await this.calendar.findWeek(
        args.week ? new Date(args.week) : new Date(),
        userId,
      );
      return {
        weekStart: week.weekStart.toISOString().slice(0, 10),
        days: week.days.map((day) => ({
          date: day.date.toISOString().slice(0, 10),
          entries: day.entries.map((entry) => ({
            id: entry.id,
            outfitId: entry.outfit.id,
            name: entry.outfit.unwrap().name,
            wornAt: entry.wornAt?.toISOString(),
            notes: entry.notes,
          })),
        })),
      };
    }
    if (name === 'create_garment' || name === 'update_garment') {
      const input = this.garmentInput(args);
      const garmentId =
        name === 'update_garment' ? this.garmentId(args.id) : undefined;
      if (garmentId !== undefined)
        await this.garments.findOne(garmentId, userId);
      else if (!input.category?.trim())
        throw new BadRequestException(
          'category is required when creating a garment',
        );
      if (args.photoUrl !== undefined) {
        if (typeof args.photoUrl !== 'string' || !args.photoUrl.trim())
          throw new BadRequestException('photoUrl must be a direct image URL');
        const photo = await this.remoteImages.download(args.photoUrl);
        // An async iterable matches the multipart upload service interface.
        // eslint-disable-next-line @typescript-eslint/require-await
        input.files = (async function* () {
          yield photo;
        })();
      }
      const garment =
        garmentId === undefined
          ? await this.garments.create(input as CreateGarmentDto, userId)
          : await this.garments.update(garmentId, input, userId, userId);
      return { garment: this.garment(garment) };
    }
    if (name === 'create_outfit')
      return {
        outfit: this.outfit(
          await this.outfits.create(this.outfitInput(args), userId),
        ),
      };
    if (name === 'update_outfit')
      return {
        outfit: this.outfit(
          await this.outfits.update(
            Number(args.id),
            this.outfitInput(args),
            userId,
          ),
        ),
      };
    if (name === 'schedule_outfit')
      return {
        calendarEntry: await this.calendar.create(
          {
            outfitId: Number(args.outfitId),
            date: new Date(args.date),
            notes: args.notes,
          },
          userId,
        ),
      };
    throw new ForbiddenException('Unknown MCP tool');
  }

  private toolScope(name: string): McpScope | undefined {
    if (
      [
        'list_garments',
        'search_garments',
        'get_garment',
        'get_garment_photo',
      ].includes(name)
    )
      return 'closet:read';
    if (['create_garment', 'update_garment'].includes(name))
      return 'closet:write';
    if (['list_outfits', 'get_outfit'].includes(name)) return 'outfits:read';
    if (['create_outfit', 'update_outfit'].includes(name))
      return 'outfits:write';
    if (name === 'get_calendar') return 'calendar:read';
    if (name === 'schedule_outfit') return 'calendar:write';
    return undefined;
  }

  private tools() {
    const common = (
      name: string,
      description: string,
      inputSchema: any,
      scope: McpScope,
      readOnlyHint: boolean,
    ) => ({
      name,
      title: name.replaceAll('_', ' '),
      description,
      inputSchema,
      annotations: {
        readOnlyHint,
        destructiveHint: false,
        openWorldHint: false,
      },
      securitySchemes: [{ type: 'oauth2', scopes: [scope] }],
    });
    return [
      common(
        'list_garments',
        'List and filter your garments. Results include photo URLs. Use nextOffset to retrieve the next page.',
        this.searchSchema(),
        'closet:read',
        true,
      ),
      common(
        'search_garments',
        'Search name, brand, notes and category; combine category, brand, color and size filters. Results include photo URLs and pagination.',
        this.searchSchema(),
        'closet:read',
        true,
      ),
      common(
        'get_garment_photo',
        'Retrieve a garment photo as MCP image content for viewing or displaying to the user. Prefers the background-removed version.',
        {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
        'closet:read',
        true,
      ),
      common(
        'get_garment',
        'Get one garment by its ID.',
        {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
        'closet:read',
        true,
      ),
      common(
        'create_garment',
        'Create a garment, optionally downloading and storing a photo from photoUrl (public direct image URL, JPEG/PNG/WebP/GIF, at most 10 MB).',
        this.garmentSchema(),
        'closet:write',
        false,
      ),
      common(
        'update_garment',
        'Update only the supplied fields. photoUrl downloads and replaces the stored photo; omit it to keep the photo. Public direct image URL, JPEG/PNG/WebP/GIF, at most 10 MB.',
        {
          ...this.garmentSchema(),
          required: ['id'],
          properties: {
            id: { type: 'integer' },
            ...this.garmentSchema().properties,
          },
        },
        'closet:write',
        false,
      ),
      common(
        'list_outfits',
        'List outfits belonging to the linked user.',
        { type: 'object', properties: {} },
        'outfits:read',
        true,
      ),
      common(
        'get_outfit',
        'Get one outfit by ID.',
        {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
        'outfits:read',
        true,
      ),
      common(
        'create_outfit',
        'Create an outfit from garment IDs owned by the linked user.',
        this.outfitSchema(),
        'outfits:write',
        false,
      ),
      common(
        'update_outfit',
        'Update an outfit belonging to the linked user.',
        {
          ...this.outfitSchema(),
          required: ['id'],
          properties: {
            id: { type: 'integer' },
            ...this.outfitSchema().properties,
          },
        },
        'outfits:write',
        false,
      ),
      common(
        'get_calendar',
        'Get the weekly outfit schedule.',
        {
          type: 'object',
          properties: {
            week: {
              type: 'string',
              description: 'Any ISO date in the requested week',
            },
          },
        },
        'calendar:read',
        true,
      ),
      common(
        'schedule_outfit',
        'Schedule an existing outfit owned by the linked user.',
        {
          type: 'object',
          required: ['outfitId', 'date'],
          properties: {
            outfitId: { type: 'integer' },
            date: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
            notes: { type: 'string' },
          },
        },
        'calendar:write',
        false,
      ),
    ];
  }
  private garmentSchema() {
    return {
      type: 'object',
      required: ['category'],
      properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        brand: { type: 'string' },
        color: { type: 'string' },
        size: { type: 'string' },
        notes: { type: 'string' },
        washingDetails: { type: 'string' },
        dateAquired: { type: 'string' },
        photoUrl: {
          type: 'string',
          format: 'uri',
          description:
            'Public direct image URL; downloaded and stored by the app, at most 10 MB. No AI recognition is performed.',
        },
      },
    };
  }
  private outfitSchema() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string' },
        notes: { type: 'string' },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            required: ['category'],
            properties: {
              category: { type: 'string' },
              garmentId: { type: ['integer', 'null'] },
            },
          },
        },
      },
    };
  }
  private garmentInput(args: Record<string, unknown>): UpdateGarmentDto {
    const input: UpdateGarmentDto = {};
    for (const field of [
      'name',
      'category',
      'brand',
      'color',
      'size',
      'notes',
      'washingDetails',
      'dateAquired',
    ] as const) {
      if (args[field] === undefined) continue;
      if (typeof args[field] !== 'string')
        throw new BadRequestException(`${field} must be a string`);
      input[field] = args[field];
    }
    if (input.category !== undefined && !input.category.trim())
      throw new BadRequestException('category cannot be empty');
    if (input.dateAquired && Number.isNaN(Date.parse(input.dateAquired)))
      throw new BadRequestException('dateAquired must be a valid date');
    return input;
  }
  private garmentId(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1)
      throw new BadRequestException('id must be a positive integer');
    return Number(value);
  }
  private pageNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
      throw new BadRequestException(
        `Pagination value must be an integer between ${min} and ${max}`,
      );
    return Number(value);
  }
  private searchInput(args: Record<string, unknown>) {
    for (const key of ['query', 'category', 'brand', 'color', 'size']) {
      if (args[key] !== undefined && typeof args[key] !== 'string')
        throw new BadRequestException(`${key} must be a string`);
    }
    if (
      args.include_archived !== undefined &&
      typeof args.include_archived !== 'boolean'
    )
      throw new BadRequestException('include_archived must be a boolean');
    return {
      keyword: args.query as string | undefined,
      category: args.category as string | undefined,
      brand: args.brand as string | undefined,
      color: args.color as string | undefined,
      size: args.size as string | undefined,
      archived: args.include_archived ? 'true' : undefined,
    };
  }
  private searchSchema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        brand: { type: 'string' },
        color: {
          type: 'string',
          description: 'One color, also matches multicolor garments',
        },
        size: { type: 'string' },
        include_archived: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    };
  }
  private outfitInput(args: any) {
    return {
      name: args.name,
      notes: args.notes,
      slots: Array.isArray(args.slots)
        ? args.slots.map((slot: any) => ({
            category: String(slot.category),
            garmentId: slot.garmentId == null ? null : Number(slot.garmentId),
          }))
        : undefined,
    };
  }
  private garment(g: any) {
    return {
      id: g.id,
      name: g.name,
      category: g.category,
      color: g.color,
      brand: g.brand,
      size: g.size,
      notes: g.notes,
      washingDetails: g.washingDetails,
      dateAquired: g.dateAquired?.toISOString().slice(0, 10),
      archived: g.archived,
      photoUrl: g.photo
        ? `${this.mcp.issuerUrl()}/file/${g.photo.fileName}`
        : null,
      photoPreviewUrl: g.photo
        ? `${this.mcp.issuerUrl()}/file/nobg/${g.photo.fileName}`
        : null,
    };
  }
  private outfit(o: any) {
    return {
      id: o.id,
      name: o.name,
      notes: o.notes,
      slots: o.slots,
      garmentIds: o.garments.getItems().map((g: any) => g.id),
    };
  }
  private result(id: JsonRpcRequest['id'], result: any) {
    return { jsonrpc: '2.0', id, result };
  }
  private error(id: JsonRpcRequest['id'], code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
