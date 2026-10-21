import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '@erp/shared';
import { Public } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

/** Polled by the uptime monitor and the container healthcheck: never rate limited. */
@SkipThrottle({ default: true, auth: true })
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up'; version: string }> {
    try {
      await this.prisma.ping();
    } catch {
      throw new AppException(ErrorCode.DB_UNAVAILABLE, 'Database unreachable');
    }
    return { status: 'ok', db: 'up', version: this.config.SENTRY_RELEASE ?? 'dev' };
  }
}
