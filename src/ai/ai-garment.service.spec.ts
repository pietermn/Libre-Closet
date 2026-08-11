import { ConfigService } from '@nestjs/config';
import { AiGarmentService, extractOutputText } from './ai-garment.service';

describe('AiGarmentService', () => {
  it('skips analysis when no API key is configured', async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new AiGarmentService(config);

    await expect(service.analyze()).resolves.toEqual({ available: false });
    expect(config.get).toHaveBeenCalledWith('OPENAI_API_KEY');
  });

  it('extracts structured output text from a raw Responses API payload', () => {
    expect(
      extractOutputText({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '{"name":"Orange cap","category":"ACCESSORIES"}',
              },
            ],
          },
        ],
      }),
    ).toBe('{"name":"Orange cap","category":"ACCESSORIES"}');
  });
});
