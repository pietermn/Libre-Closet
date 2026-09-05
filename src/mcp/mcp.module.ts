import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { RemoteImageService } from './remote-image.service';
import { AuthModule } from '../auth/auth.module';
import { McpAuditLog } from '../dal/entity/mcp-audit-log.entity';
import { McpAuthorizationCode } from '../dal/entity/mcp-authorization-code.entity';
import { McpOAuthClient } from '../dal/entity/mcp-oauth-client.entity';
import { McpToken } from '../dal/entity/mcp-token.entity';
import { User } from '../dal/entity/user.entity';
import { WardrobeModule } from '../wardrobe/wardrobe.module';
import {
  McpConnectionController,
  McpController,
  McpMetadataController,
  McpOAuthController,
} from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [
    FileModule,
    AuthModule,
    WardrobeModule,
    MikroOrmModule.forFeature([
      McpOAuthClient,
      McpAuthorizationCode,
      McpToken,
      McpAuditLog,
      User,
    ]),
  ],
  controllers: [
    McpController,
    McpOAuthController,
    McpMetadataController,
    McpConnectionController,
  ],
  providers: [McpService, RemoteImageService],
  exports: [McpService],
})
export class McpModule {}
