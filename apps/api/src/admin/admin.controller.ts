import {
  Body,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  type AdminAuthResponse,
  type AdminInfo,
  type AdminLoginInput,
  adminLoginSchema,
  type AdminTenantDetail,
  type AdminTenantRow,
  type AdminTenantsQuery,
  adminTenantsQuerySchema,
  CLIENT_TYPE_HEADER,
  ErrorCode,
  type ImpersonationResponse,
  type RecordSubscriptionPaymentInput,
  recordSubscriptionPaymentSchema,
  type SubscriptionSummary,
  type UpdateSubscriptionInput,
  updateSubscriptionSchema,
} from '@erp/shared';
import type { ClientMeta } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  ADMIN_SESSION_HOURS,
  type AdminIssuedTokens,
  AdminAuthService,
} from './admin-auth.service';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminController, AdminPublic, CurrentAdmin } from './admin.decorators';
import type { CurrentAdminInfo } from './admin.types';

export const ADMIN_REFRESH_COOKIE = 'erp_admin_rt';
/** The admin refresh cookie only goes to the admin auth routes. */
const cookiePath = (config: AppConfig): string => `${config.PUBLIC_PATH_PREFIX}/admin/auth`;

@AdminController('auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @AdminPublic()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponse> {
    const meta: ClientMeta = { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
    return this.respond(req, res, await this.auth.login(body, meta));
  }

  @AdminPublic()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: { refreshToken?: unknown } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponse> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const fromBody = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    try {
      return this.respond(
        req,
        res,
        await this.auth.refresh(fromBody ?? cookies[ADMIN_REFRESH_COOKIE]),
      );
    } catch (err) {
      res.clearCookie(ADMIN_REFRESH_COOKIE, { path: cookiePath(this.config) });
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAdmin() admin: CurrentAdminInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(admin);
    res.clearCookie(ADMIN_REFRESH_COOKIE, { path: cookiePath(this.config) });
  }

  @Get('me')
  me(@CurrentAdmin() admin: CurrentAdminInfo): AdminInfo {
    return { id: admin.id, email: admin.email, fullName: admin.fullName };
  }

  private respond(req: Request, res: Response, tokens: AdminIssuedTokens): AdminAuthResponse {
    const { refreshToken, ...rest } = tokens;
    if (req.get(CLIENT_TYPE_HEADER) === 'native')
      return { ...rest, refreshToken } as AdminAuthResponse;
    res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: cookiePath(this.config),
      maxAge: ADMIN_SESSION_HOURS * 3_600_000,
    });
    return rest;
  }
}

@AdminController('tenants')
export class AdminTenantsController {
  constructor(private readonly tenants: AdminTenantsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminTenantsQuerySchema)) query: AdminTenantsQuery,
  ): Promise<AdminTenantRow[]> {
    return this.tenants.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTenantDetail> {
    return this.tenants.detail(id);
  }

  @Post(':id/payments')
  async recordPayment(
    @CurrentAdmin() admin: CurrentAdminInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(recordSubscriptionPaymentSchema))
    body: RecordSubscriptionPaymentInput,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubscriptionSummary> {
    if (!key || key.length > 100) {
      throw new AppException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Idempotency-Key header required');
    }
    const { summary, replayed } = await this.tenants.recordPayment(admin, id, body, key);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return summary;
  }

  @Patch(':id/subscription')
  update(
    @CurrentAdmin() admin: CurrentAdminInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSubscriptionSchema)) body: UpdateSubscriptionInput,
  ): Promise<SubscriptionSummary> {
    return this.tenants.updateSubscription(admin, id, body);
  }

  @Post(':id/impersonate')
  @HttpCode(HttpStatus.OK)
  impersonate(
    @CurrentAdmin() admin: CurrentAdminInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImpersonationResponse> {
    return this.tenants.impersonate(admin, id);
  }
}
