import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

const EVERY_6_HOURS = 6 * 60 * 60 * 1000;

/**
 * Drops the bytes of import files past their retention period (30 days). The
 * ImportJob row itself stays for audit. Runs across tenants on purpose.
 */
@Injectable()
export class ImportFilesJanitor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ImportFilesJanitor.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    void this.purge();
    this.timer = setInterval(() => void this.purge(), EVERY_6_HOURS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async purge(now = new Date()): Promise<number> {
    try {
      const { count } = await tenantContext.run({ system: true }, () =>
        this.prisma.db.importJob.updateMany({
          where: { fileExpiresAt: { lt: now }, fileData: { not: null } },
          data: { fileData: null },
        }),
      );
      if (count > 0) this.logger.log(`Dropped ${count} expired import file(s)`);
      return count;
    } catch (err) {
      this.logger.error(err instanceof Error ? err.message : String(err));
      return 0;
    }
  }
}
