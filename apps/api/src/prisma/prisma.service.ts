import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaClient } from '../generated/prisma/client';
import { tenantExtension } from './tenant-extension';

function createClients(databaseUrl: string) {
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  return { base, db: base.$extends(tenantExtension) };
}

export type TenantPrismaClient = ReturnType<typeof createClients>['db'];
/** The client handed to `$transaction(async (tx) => …)` callbacks. Pass it to services. */
export type Tx = Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0];

@Injectable()
export class PrismaService implements OnModuleDestroy {
  /** Tenant-scoped client. Use this for all business data access. */
  readonly db: TenantPrismaClient;
  private readonly base: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const clients = createClients(config.DATABASE_URL);
    this.base = clients.base;
    this.db = clients.db;
  }

  /** Cheap connectivity check for /health. */
  async ping(): Promise<void> {
    await this.base.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}
