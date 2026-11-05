import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { nextAlgiersTime } from '../common/algiers';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AssistantService } from './assistant.service';

/**
 * Deletes conversations older than 90 days, every night, on the VPS. A timer cannot be
 * trusted on Vercel, so each question also clears its own company's (AssistantService).
 */
@Injectable()
export class AssistantRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AssistantRetentionService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly assistant: AssistantService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV !== 'test') this.schedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
  }

  private schedule(): void {
    const at = nextAlgiersTime(3, 30);
    this.timer = setTimeout(() => {
      void this.nightly().finally(() => this.schedule());
    }, at.getTime() - Date.now());
    this.timer.unref();
  }

  private async nightly(): Promise<void> {
    try {
      const count = await this.assistant.purgeAllExpired();
      this.logger.log({ count }, 'Old assistant conversations deleted');
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
      Sentry.captureException(err);
    }
  }
}
