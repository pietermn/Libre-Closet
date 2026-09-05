import { MikroORM } from '@mikro-orm/better-sqlite';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { MultipartFile } from '@fastify/multipart';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { User } from '../dal/entity/user.entity';
import { Garment } from '../dal/entity/garment.entity';
import { File } from '../dal/entity/file.entity';
import { LocalFileService } from '../file/local-file/local-file.service';
import { GarmentService } from '../wardrobe/garment.service';
import { WardrobeShareService } from '../wardrobe-share/wardrobe-share.service';
import { OutfitService } from '../wardrobe/outfit.service';
import { CalendarService } from '../wardrobe/calendar.service';
import { McpController } from './mcp.controller';
import { McpService, MCP_SCOPES } from './mcp.service';
import { RemoteImageService } from './remote-image.service';

describe('MCP garment tools with real storage', () => {
  let orm: MikroORM;
  let directory: string;
  let controller: McpController;
  let user: User;
  let scopes: string[];
  const download = jest.fn();

  beforeEach(async () => {
    orm = await MikroORM.init({ entities: [User], dbName: ':memory:' });
    await orm.schema.createSchema();
    directory = await mkdtemp(join(tmpdir(), 'closet-mcp-'));
    const em = orm.em.fork();
    user = Object.assign(new User(), {
      email: 'owner@example.test',
      password: 'test',
    });
    await em.persistAndFlush(user);
    const files = new LocalFileService(
      new ConfigService({ DATA_PATH: directory }),
      em.getRepository(File),
      em,
    );
    const garments = new GarmentService(
      em.getRepository(Garment),
      em.getRepository(User),
      files,
      {} as WardrobeShareService,
    );
    scopes = [...MCP_SCOPES];
    const mcp = {
      authenticate: () =>
        Promise.resolve({
          userId: user.id,
          clientId: 1,
          tokenId: 1,
          scopes,
        }),
      issuerUrl: () => 'https://closet.example.test',
      consumeRateLimit: jest.fn(),
      audit: jest.fn(),
    } as unknown as McpService;
    download.mockReset();
    download.mockImplementation(async () => {
      const bytes = await sharp({
        create: { width: 20, height: 20, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer();
      return {
        type: 'file',
        fieldname: 'photo',
        mimetype: 'image/png',
        file: Readable.from(bytes),
      } as MultipartFile;
    });
    controller = new McpController(
      mcp,
      garments,
      {} as OutfitService,
      {} as CalendarService,
      { download } as unknown as RemoteImageService,
      files,
    );
  });

  afterEach(async () => {
    await orm.close(true);
    await rm(directory, { recursive: true, force: true });
  });

  async function call(name: string, args = {}) {
    const response = await controller.handle(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      'Bearer test',
      {} as FastifyRequest,
      {} as FastifyReply,
    );
    if (!response || !('result' in response))
      throw new Error('Expected a tool result');
    return response.result;
  }
  async function create(args = {}) {
    const result = await call('create_garment', {
      name: 'Blue coat',
      category: 'outerwear',
      brand: 'Example',
      color: 'blue',
      size: 'M',
      notes: 'Keep this',
      ...args,
    });
    expect(result.isError).toBeUndefined();
    return result.structuredContent.garment;
  }

  it('stores a URL photo in uploads and returns display URLs and actual MCP image content', async () => {
    const garment = await create({
      photoUrl: 'https://images.example.test/coat.png',
    });
    expect(download).toHaveBeenCalledWith(
      'https://images.example.test/coat.png',
    );
    const fileName = garment.photoUrl.split('/').pop();
    await expect(
      access(join(directory, 'uploads', fileName)),
    ).resolves.toBeUndefined();
    expect(garment.photoPreviewUrl).toBe(
      `https://closet.example.test/file/nobg/${fileName}`,
    );
    const result = await call('get_garment_photo', { id: garment.id });
    expect(result.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/webp',
    });
    expect(
      (await sharp(Buffer.from(result.content[0].data, 'base64')).metadata())
        .format,
    ).toBe('webp');
    const fetched = await call('get_garment', { id: garment.id });
    expect(fetched.structuredContent.garment.photoUrl).toBe(garment.photoUrl);
  });

  it('changes only supplied fields on an owned garment', async () => {
    const garment = await create();
    const updated = await call('update_garment', {
      id: garment.id,
      name: 'My coat',
    });
    expect(updated.isError).toBeUndefined();
    expect(updated.structuredContent.garment).toMatchObject({
      name: 'My coat',
      category: 'outerwear',
      brand: 'Example',
      color: 'blue',
      size: 'Medium',
      notes: 'Keep this',
    });
  });

  it('keeps the original photo and fields after a failed download', async () => {
    const garment = await create({
      photoUrl: 'https://images.example.test/coat.png',
    });
    download.mockRejectedValueOnce(new Error('Download failed'));
    expect(
      (
        await call('update_garment', {
          id: garment.id,
          name: 'Should not change',
          photoUrl: 'https://images.example.test/broken',
        })
      ).isError,
    ).toBe(true);
    const fetched = await call('get_garment', { id: garment.id });
    expect(fetched.structuredContent.garment).toMatchObject({
      name: 'Blue coat',
      photoUrl: garment.photoUrl,
    });
    expect(
      (await call('get_garment_photo', { id: garment.id })).isError,
    ).toBeUndefined();
  });

  it('replaces a photo without requiring any other fields', async () => {
    const garment = await create({
      photoUrl: 'https://images.example.test/first.png',
    });
    const result = await call('update_garment', {
      id: garment.id,
      photoUrl: 'https://images.example.test/second.png',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.garment).toMatchObject({
      name: 'Blue coat',
      brand: 'Example',
      notes: 'Keep this',
    });
    expect(result.structuredContent.garment.photoUrl).not.toBe(
      garment.photoUrl,
    );
    await expect(
      access(join(directory, 'uploads', garment.photoUrl.split('/').pop())),
    ).rejects.toThrow();
  });

  it('checks scopes before downloading or changing anything', async () => {
    scopes = ['closet:read'];
    const result = await call('create_garment', {
      category: 'tops',
      photoUrl: 'https://images.example.test/photo',
    });
    expect(result.isError).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects other users before fetching a replacement or revealing a photo', async () => {
    const garment = await create();
    user = { id: user.id + 100 } as User;
    expect(
      (
        await call('update_garment', {
          id: garment.id,
          photoUrl: 'https://images.example.test/photo',
        })
      ).isError,
    ).toBe(true);
    expect((await call('get_garment_photo', { id: garment.id })).isError).toBe(
      true,
    );
    expect(download).not.toHaveBeenCalled();
  });

  it('combines case-insensitive filters and paginates without exposing another account', async () => {
    const first = await create({ name: 'Raincoat' });
    const second = await create({ name: 'Winter coat' });
    await create({ category: 'tops' });
    const filters = {
      query: 'OUTERWEAR',
      category: 'OUTERWEAR',
      brand: 'example',
      color: 'BLUE',
      size: 'M',
      limit: 1,
    };
    const result = (await call('search_garments', filters)).structuredContent;
    expect(result).toMatchObject({
      total: 2,
      limit: 1,
      offset: 0,
      nextOffset: 1,
    });
    expect(result.garments[0].id).toBe(second.id);
    const next = (
      await call('search_garments', { ...filters, offset: result.nextOffset })
    ).structuredContent;
    expect(next.garments[0].id).toBe(first.id);
    expect(next.nextOffset).toBeNull();
    user = { id: user.id + 100 } as User;
    expect((await call('list_garments')).structuredContent.total).toBe(0);
  });

  it('matches individual colors in combinations and includes archived items only on request', async () => {
    const first = await create({ color: 'red, blue,white' });
    const archived = await create({ color: 'blue,red' });
    await create({ color: 'blueberry' });
    await orm.em
      .fork()
      .nativeUpdate(Garment, { id: archived.id }, { archived: true });
    const active = (await call('search_garments', { color: 'blue' }))
      .structuredContent;
    expect(active.garments.map((g: Garment) => g.id)).toEqual([first.id]);
    const all = (
      await call('list_garments', { color: 'blue', include_archived: true })
    ).structuredContent;
    expect(all.total).toBe(2);
  });

  it('reports missing photos and rejects invalid pagination and field types', async () => {
    const garment = await create();
    expect((await call('get_garment_photo', { id: garment.id })).isError).toBe(
      true,
    );
    expect((await call('list_garments', { limit: 101 })).isError).toBe(true);
    expect(
      (await call('update_garment', { id: garment.id, category: '' })).isError,
    ).toBe(true);
    expect(
      (
        await call('update_garment', {
          id: garment.id,
          name: { nested: 'bad' },
        })
      ).isError,
    ).toBe(true);
  });
});
