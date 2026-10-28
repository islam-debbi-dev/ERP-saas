import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminAuthController, AdminTenantsController } from './admin.controller';
import { PlatformAuditService } from './platform-audit.service';

/** Super-admin area (phase 13): separate identity with TOTP, outside every tenant. */
@Module({
  imports: [
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
  controllers: [AdminAuthController, AdminTenantsController],
  providers: [AdminAuthGuard, AdminAuthService, AdminTenantsService, PlatformAuditService],
})
export class AdminModule {}
