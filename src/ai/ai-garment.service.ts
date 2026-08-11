import { MultipartFile } from '@fastify/multipart';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { GarmentCategory } from '../wardrobe/garment-category.enum';

export type GarmentSuggestion = {
  available: boolean;
  category?: string;
  name?: string;
  brand?: string;
  colors?: string[];
  size?: string;
  washingDetails?: string;
  material?: string;
  pattern?: string;
};

type ResponsesApiPayload = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

/** Extract text from the raw Responses API payload (unlike the SDK, fetch has no output_text helper). */
export function extractOutputText(
  payload: ResponsesApiPayload,
): string | undefined {
  for (const output of payload.output ?? []) {
    if (output.type !== 'message') continue;

    const text = output.content?.find(
      (content) => content.type === 'output_text' && content.text,
    )?.text;
    if (text) return text;
  }
}

@Injectable()
export class AiGarmentService {
  private readonly logger = new Logger(AiGarmentService.name);

  constructor(private readonly config: ConfigService) {}

  async analyze(upload?: MultipartFile): Promise<GarmentSuggestion> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) return { available: false };
    if (!upload?.mimetype.startsWith('image/')) return { available: true };

    const compressed = await sharp(await upload.toBuffer())
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    const imageUrl = `data:image/webp;base64,${compressed.toString('base64')}`;

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.get<string>('OPENAI_MODEL', 'gpt-5.6-luna'),
          store: false,
          // This is a fast classification task. Avoid spending the response
          // budget on reasoning so there is always room for the JSON schema.
          reasoning: { effort: 'none' },
          max_output_tokens: 320,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Create a practical wardrobe suggestion from this garment photo. Name must be a short, natural wardrobe label of two to four words: color plus garment type, with one useful descriptor only when it distinguishes the item. Do not put the brand, logo, material, or vague marketing terms in name. For example, name an orange baseball cap "Orange baseball cap", not "Orange embroidered polo baseball cap". Identify a brand only when a readable label, wordmark, or recognizable logo supports it—never guess a brand. Use a visible label for exact size and care instructions when possible. When no label is visible, provide a sensible, conservative estimate for size and washing details based on garment type and construction, because the user will review and edit every field. For example, an adjustable baseball cap is usually "One Size" and its care can be "Spot clean with a damp cloth; avoid machine washing and tumble drying." Return null only when no useful suggestion can be made.',
                },
                { type: 'input_image', image_url: imageUrl, detail: 'low' },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'garment_suggestion',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  category: {
                    type: ['string', 'null'],
                    enum: [...Object.values(GarmentCategory), null],
                  },
                  name: {
                    type: ['string', 'null'],
                    description:
                      'Two to four words: color plus garment type. Never include the brand or marketing language.',
                  },
                  brand: { type: ['string', 'null'] },
                  colors: { type: 'array', items: { type: 'string' } },
                  size: { type: ['string', 'null'] },
                  washingDetails: { type: ['string', 'null'] },
                  material: { type: ['string', 'null'] },
                  pattern: { type: ['string', 'null'] },
                },
                required: [
                  'category',
                  'name',
                  'brand',
                  'colors',
                  'size',
                  'washingDetails',
                  'material',
                  'pattern',
                ],
              },
            },
          },
        }),
      });
      if (!response.ok) {
        this.logger.warn(`Garment analysis unavailable: ${response.status}`);
        return { available: true };
      }
      const payload = (await response.json()) as ResponsesApiPayload;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logger.warn('Garment analysis returned no output text');
        return { available: true };
      }
      const result = JSON.parse(outputText) as Omit<
        GarmentSuggestion,
        'available'
      >;
      return {
        available: true,
        ...Object.fromEntries(
          Object.entries(result).filter(
            ([, value]) => value !== null && value !== '',
          ),
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Garment analysis failed: ${message}`);
      return { available: true };
    }
  }
}
