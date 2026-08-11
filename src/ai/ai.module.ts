import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiController } from './ai.controller';
import { AiGarmentService } from './ai-garment.service';

@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiGarmentService],
})
export class AiModule {}
