import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ConditionalAuthGuard } from '../auth/conditional-auth.guard';
import type { FastifyRequest } from 'fastify';
import { AiGarmentService } from './ai-garment.service';

@UseGuards(ConditionalAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly garmentAi: AiGarmentService) {}

  @Post('garment-analysis')
  async analyzeGarment(@Req() req: FastifyRequest) {
    const upload = await req.file({ limits: { files: 1 } });
    return this.garmentAi.analyze(upload);
  }
}
