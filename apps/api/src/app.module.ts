import { randomUUID } from 'node:crypto';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import {
  ASSISTANT_THROTTLE_FLAG,
  ASSISTANT_THROTTLER,
} from './assistant/assistant-throttler.guard';
import { AssistantModule } from './assistant/assistant.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ClockModule } from './clock/clock.module';
import { CatalogModule } from './catalog/catalog.module';
import { ClientsModule } from './clients/clients.module';
import { PaymentsModule } from './payments/payments.module';
import { SalesModule } from './sales/sales.module';
import { SalesForceModule } from './sales-force/sales-force.module';
import { GeoModule } from './geo/geo.module';
import { IncentivesModule } from './incentives/incentives.module';
import { PackagingModule } from './packaging/packaging.module';
import { PromotionsModule } from './promotions/promotions.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health/health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { ImportsModule } from './imports/imports.module';
import { PrintingModule } from './printing/printing.module';
import { PrismaModule } from './prisma/prisma.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HrModule } from './hr/hr.module';
import { PayrollModule } from './payroll/payroll.module';
import { ImportFilesModule } from './import-files/import-files.module';
import { PurchasesModule } from './purchases/purchases.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { TreasuryModule } from './treasury/treasury.module';
import { ReportsModule } from './reports/reports.module';
import { StockModule } from './stock/stock.module';
import { TenantsModule } from './tenants/tenants.module';
import { TourneesModule } from './tournees/tournees.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          genReqId: (req, res) => {
            const header = req.headers['x-request-id'];
            const id = typeof header === 'string' && header.length <= 100 ? header : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          transport:
            config.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    // In memory: one API process in the MVP (see the login limiter for the same choice).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE },
          {
            // Unauthenticated entry points that cost a password hash or a token lookup.
            // Login also has its own per-identifier limiter and account lock.
            name: 'auth',
            ttl: 60_000,
            limit: config.RATE_LIMIT_AUTH_PER_MINUTE,
            skipIf: (ctx) =>
              !/^\/(admin\/)?auth\//.test(ctx.switchToHttp().getRequest<{ path: string }>().path),
          },
          {
            // Per user, so counted by AssistantThrottlerGuard after authentication.
            name: ASSISTANT_THROTTLER,
            ttl: 60_000,
            limit: config.RATE_LIMIT_ASSISTANT_PER_MINUTE,
            skipIf: (ctx) =>
              !ctx.switchToHttp().getRequest<Record<string, unknown>>()[ASSISTANT_THROTTLE_FLAG],
            getTracker: (req) => (req['user'] as { id: string }).id,
          },
        ],
      }),
    }),
    PrismaModule,
    ClockModule,
    BillingModule,
    AuditModule,
    SalesForceModule,
    GeoModule,
    IncentivesModule,
    PromotionsModule,
    PackagingModule,
    IdempotencyModule,
    DocumentsModule,
    AuthModule,
    TenantsModule,
    CatalogModule,
    StockModule,
    PurchasesModule,
    ImportFilesModule,
    ExpensesModule,
    HrModule,
    PayrollModule,
    ClientsModule,
    SalesModule,
    PaymentsModule,
    PrintingModule,
    ImportsModule,
    ReportsModule,
    UsersModule,
    ReconcileModule,
    TreasuryModule,
    TourneesModule,
    AssistantModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
