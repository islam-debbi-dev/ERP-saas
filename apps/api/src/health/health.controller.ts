import { Controller, Get } from '@nestjs/common';
import { ErrorCode } from '@erp/shared';
import { Public } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await this.prisma.ping();
    } catch {
      throw new AppException(ErrorCode.DB_UNAVAILABLE, 'Database unreachable');
    }
    return { status: 'ok', db: 'up' };
  }
}
