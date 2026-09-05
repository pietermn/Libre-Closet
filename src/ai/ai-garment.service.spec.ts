import { MultipartFile } from '@fastify/multipart';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { AiGarmentService, extractOutputText } from './ai-garment.service';

describe('AiGarmentService', () => {
  let fetchMock: jest.SpyInstance;
  let service: AiGarmentService;
  let upload: MultipartFile;
  const completed = (value: unknown) => ({
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(value) }],
      },
    ],
  });
  const respond = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status });

  beforeEach(async () => {
    fetchMock = jest.spyOn(global, 'fetch');
    service = new AiGarmentService({
      get: (key: string, fallback: string) =>
        key === 'OPENAI_API_KEY' ? 'test-key' : fallback,
    } as ConfigService);
    const buffer = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: 'orange' },
    })
      .png()
      .toBuffer();
    upload = {
      mimetype: 'image/png',
      toBuffer: jest.fn().mockResolvedValue(buffer),
    } as unknown as MultipartFile;
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips analysis when no API key is configured', async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    await expect(new AiGarmentService(config).analyze()).resolves.toEqual({
      available: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts text after reasoning output', () => {
    expect(
      extractOutputText({
        output: [
          { type: 'reasoning' },
          ...completed({ name: 'Orange cap' }).output,
        ],
      }),
    ).toBe('{"name":"Orange cap"}');
  });

  it('uses detailed images, supported colors and only validated form fields', async () => {
    fetchMock.mockResolvedValue(
      respond(
        completed({
          name: ' Orange cap ',
          category: 'accessories',
          brand: 'Example',
          size: null,
          colors: ['orange', 'orange', 'navy'],
          washingDetails: 12,
          available: false,
          unexpected: 'ignored',
        }),
      ),
    );
    await expect(service.analyze(upload)).resolves.toEqual({
      available: true,
      status: 'success',
      name: 'Orange cap',
      category: 'accessories',
      brand: 'Example',
      colors: ['orange'],
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const image = request.input[0].content[1];
    expect(image.detail).toBe('high');
    const metadata = await sharp(
      Buffer.from(image.image_url.split(',')[1], 'base64'),
    ).metadata();
    expect(metadata.width).toBe(1536);
    expect(request.max_output_tokens).toBe(1200);
    expect(request.text.format.schema.properties.colors.items.enum).toContain(
      'grey',
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('retries truncated output with more room without parsing partial JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respond({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"name":' }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(respond(completed({ name: 'Orange cap' })));
    expect(await service.analyze(upload)).toMatchObject({
      status: 'success',
      name: 'Orange cap',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_output_tokens).toBe(
      2400,
    );
    expect(upload.toBuffer).toHaveBeenCalledTimes(1);
  });

  it('reports repeated truncation as an error', async () => {
    fetchMock.mockImplementation(async () =>
      respond({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    );
    expect(await service.analyze(upload)).toMatchObject({
      available: true,
      status: 'error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('handles corrupt photos without calling the provider', async () => {
    (upload.toBuffer as jest.Mock).mockResolvedValue(Buffer.from('broken'));
    expect(await service.analyze(upload)).toMatchObject({
      status: 'error',
      message: expect.stringContaining('could not be read'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a temporary provider error', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ error: { code: 'server_error' } }, 503))
      .mockResolvedValueOnce(respond(completed({ name: 'Orange cap' })));
    expect(await service.analyze(upload)).toMatchObject({ status: 'success' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    fetchMock.mockResolvedValue(
      respond({ error: { code: 'invalid_api_key' } }, 401),
    );
    expect(await service.analyze(upload)).toMatchObject({ status: 'error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('distinguishes no recognizable garment from a provider failure', async () => {
    fetchMock.mockResolvedValue(respond(completed({ name: null, colors: [] })));
    expect(await service.analyze(upload)).toMatchObject({ status: 'empty' });
  });

  it('reports refusals without retrying', async () => {
    fetchMock.mockResolvedValue(
      respond({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal' }] }],
      }),
    );
    expect(await service.analyze(upload)).toMatchObject({ status: 'error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles malformed structured output with a bounded retry', async () => {
    fetchMock.mockImplementation(async () => respond(completed(null)));
    expect(await service.analyze(upload)).toMatchObject({ status: 'error' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops on deadline expiry', async () => {
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    fetchMock.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
    expect(await service.analyze(upload)).toMatchObject({
      status: 'error',
      message: expect.stringContaining('too long'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
