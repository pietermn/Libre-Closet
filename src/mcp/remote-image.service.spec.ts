import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import * as dns from 'node:dns/promises';
import * as https from 'node:https';
import sharp from 'sharp';
import {
  RemoteImageService,
  isPublicImageAddress,
  MAX_PHOTO_BYTES,
} from './remote-image.service';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

const lookup = jest.mocked(dns.lookup);
const request = jest.mocked(https.request);

describe('Remote image download', () => {
  let service: RemoteImageService;
  let png: Buffer;
  const respond = (body: Buffer | Buffer[], statusCode = 200, headers = {}) => {
    const response = Object.assign(
      Readable.from(Array.isArray(body) ? body : [body]),
      { statusCode, headers },
    );
    request.mockImplementationOnce(((_url, _options, callback) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => callback!(response as IncomingMessage),
      });
      return req;
    }) as typeof https.request);
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    service = new RemoteImageService();
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
  });
  afterEach(() => jest.restoreAllMocks());

  it('downloads and decodes actual bytes and pins the validated DNS address', async () => {
    respond(png);
    const photo = await service.download('https://images.example.test/photo');
    expect(photo.mimetype).toBe('image/webp');
    expect((await sharp(await photo.toBuffer()).metadata()).format).toBe(
      'webp',
    );
    const options = request.mock.calls[0][1];
    const callback = jest.fn();
    options.lookup!('images.example.test', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(options.agent).toBe(false);
    options.lookup!('images.example.test', { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it.each([
    'http://127.0.0.1/photo',
    'https://[::1]/photo',
    'https://[::ffff:127.0.0.1]/photo',
    'https://169.254.169.254/photo',
    'file:///etc/passwd',
    'https://user:password@example.test/photo',
    'https://example.test:8080/photo',
  ])('blocks unsafe URL %s', async (url) => {
    await expect(service.download(url)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects mixed public and private DNS answers', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('public internet');
    expect(request).not.toHaveBeenCalled();
  });

  it('validates redirect destinations before connecting', async () => {
    respond(Buffer.alloc(0), 302, { location: 'https://127.0.0.1/private' });
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('public internet');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('supports a public redirect to another image host', async () => {
    respond(Buffer.alloc(0), 302, {
      location: 'https://cdn.example.test/photo',
    });
    respond(png);
    expect(
      (await service.download('https://images.example.test/photo')).mimetype,
    ).toBe('image/webp');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('limits redirect loops', async () => {
    for (let i = 0; i < 4; i++)
      respond(Buffer.alloc(0), 302, { location: '/again' });
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('redirects too many');
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('rejects large streamed responses even without Content-Length', async () => {
    respond([Buffer.alloc(MAX_PHOTO_BYTES), Buffer.from('x')]);
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('10 MB');
  });

  it('rejects oversized declared content and HTTP errors', async () => {
    respond(Buffer.alloc(0), 200, {
      'content-length': String(MAX_PHOTO_BYTES + 1),
    });
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('10 MB');
    respond(Buffer.alloc(0), 403);
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('publicly accessible');
  });

  it('rejects HTML masquerading as an image', async () => {
    respond(Buffer.from('<html>Access denied</html>'), 200, {
      'content-type': 'image/png',
    });
    await expect(
      service.download('https://images.example.test/photo'),
    ).rejects.toThrow('valid photo');
  });

  it('bounds a stalled DNS lookup', async () => {
    const abort = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    lookup.mockReturnValue(new Promise(() => {}));
    const download = service.download('https://images.example.test/photo');
    abort.abort();
    await expect(download).rejects.toThrow('timed out');
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    '192.168.1.1',
    '10.0.0.1',
    '172.16.0.1',
    '100.64.0.1',
    '0.0.0.0',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicImageAddress(address)).toBe(false);
  });
});
