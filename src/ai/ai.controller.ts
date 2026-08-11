import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ConditionalAuthGuard } from '../auth/conditional-auth.guard';
import type { FastifyRequest } from 'fastify';
import { AiGarmentService } from './ai-garment.service';
import { seconds, Throttle } from '@nestjs/throttler';

@UseGuards(ConditionalAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly garmentAi: AiGarmentService) {}

  @Post('garment-analysis')
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  async analyzeGarment(@Req() req: FastifyRequest) {
    const upload = await req.file({
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    });
    return this.garmentAi.analyze(upload);
  }
}
