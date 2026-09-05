import { BadRequestException, Injectable } from '@nestjs/common';
import { MultipartFile } from '@fastify/multipart';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import ipaddr from 'ipaddr.js';
import sharp from 'sharp';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function isPublicImageAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export async function readPhotoBytes(
  stream: AsyncIterable<Buffer | string>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_PHOTO_BYTES)
      throw new BadRequestException('Photo must be at most 10 MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class RemoteImageService {
  async download(photoUrl: string): Promise<MultipartFile> {
    const signal = AbortSignal.timeout(20_000);
    try {
      const source = await this.fetchImage(photoUrl, signal);
      const metadata = await sharp(source, {
        limitInputPixels: 40_000_000,
        failOn: 'error',
      }).metadata();
      if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? '')) {
        throw new BadRequestException(
          'Photo URL must return a JPEG, PNG, WebP or GIF image',
        );
      }
      const buffer = await sharp(source, {
        limitInputPixels: 40_000_000,
        failOn: 'error',
      })
        .rotate()
        .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
      // Adapt the downloaded bytes to the existing local/S3 upload pipeline.
      return {
        type: 'file',
        fieldname: 'photo',
        filename: 'download.webp',
        mimetype: 'image/webp',
        encoding: '7bit',
        fields: {},
        toBuffer: () => Promise.resolve(buffer),
        file: Object.assign(Readable.from(buffer), {
          truncated: false,
          bytesRead: buffer.length,
        }),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        signal.aborted
          ? 'Photo download timed out; try another URL'
          : 'Could not download a valid photo. Use a publicly accessible direct image URL',
      );
    }
  }

  private async fetchImage(
    input: string,
    signal: AbortSignal,
  ): Promise<Buffer> {
    let url = new URL(input);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const address = await this.publicAddress(url, signal);
      signal.throwIfAborted();
      const response = await this.request(url, address, signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const location = response.headers.location;
        response.destroy();
        if (!location || redirects === 3)
          throw new BadRequestException('Photo URL redirects too many times');
        url = new URL(location, url);
        continue;
      }
      try {
        if (response.statusCode !== 200)
          throw new BadRequestException(
            'Photo URL did not return an image; check that it is publicly accessible',
          );
        if (Number(response.headers['content-length']) > MAX_PHOTO_BYTES)
          throw new BadRequestException('Photo must be at most 10 MB');
        return await readPhotoBytes(response);
      } finally {
        response.destroy();
      }
    }
    throw new BadRequestException('Photo URL redirects too many times');
  }

  private async publicAddress(
    url: URL,
    signal: AbortSignal,
  ): Promise<{ address: string; family: number }> {
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new BadRequestException(
        'Use a public HTTP or HTTPS photo URL without credentials or a custom port',
      );
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const resolution = isIP(hostname)
      ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
      : lookup(hostname, { all: true });
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Photo lookup timed out'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try {
      const addresses = await Promise.race([resolution, aborted]);
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicImageAddress(address))
      ) {
        throw new BadRequestException(
          'Photo URL must resolve only to public internet addresses',
        );
      }
      return addresses[0];
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private request(
    url: URL,
    address: { address: string; family: number },
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    // Pin the checked address, preserving the original Host header and TLS name.
    // Never resolve it a second time during connection (DNS rebinding).
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          lookup: pinnedLookup,
          agent: false,
          signal,
          headers: {
            Accept: 'image/jpeg,image/png,image/webp,image/gif',
            'Accept-Encoding': 'identity',
          },
        },
        resolve,
      );
      request.on('error', reject);
      request.end();
    });
  }
}
