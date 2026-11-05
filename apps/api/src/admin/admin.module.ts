import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AssistantModule } from '../assistant/assistant.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminPayrollRatesService } from './admin-payroll-rates.service';
import { AdminTenantsService } from './admin-tenants.service';
import {
  AdminAssistantController,
  AdminAuthController,
  AdminPayrollRatesController,
  AdminTenantsController,
} from './admin.controller';
import { PlatformAuditService } from './platform-audit.service';

/** Super-admin area (phase 13): separate identity with TOTP, outside every tenant. */
@Module({
  imports: [
    AssistantModule,
    AuthModule,
    BillingModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [
    AdminAssistantController,
    AdminAuthController,
    AdminTenantsController,
    AdminPayrollRatesController,
  ],
  providers: [
    AdminAuthGuard,
    AdminAuthService,
    AdminPayrollRatesService,
    AdminTenantsService,
    PlatformAuditService,
  ],
})
export class AdminModule {}
