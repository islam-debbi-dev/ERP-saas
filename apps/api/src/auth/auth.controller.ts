import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
  type AuthResponse,
  type AuthUser,
  type ChangePasswordInput,
  changePasswordSchema,
  CLIENT_TYPE_HEADER,
  type InvitationInfoDto,
  type LoginInput,
  loginSchema,
  type RefreshInput,
  refreshSchema,
  type RegisterInput,
  registerSchema,
  type SessionInfo,
  type TenantSessionDto,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { type IssuedTokens, AuthService } from './auth.service';
import type { ClientMeta, CurrentUserInfo } from './auth.types';
import { AllowPendingPasswordChange, CurrentUser, Public } from './decorators';

export const REFRESH_COOKIE = 'erp_rt';
/** The browser sends the refresh cookie to the auth routes only. */
const refreshCookiePath = (config: AppConfig): string => `${config.PUBLIC_PATH_PREFIX}/auth`;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(req, res, await this.auth.register(body, this.meta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(req, res, await this.auth.login(body, this.meta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const token = body?.refreshToken ?? cookies[REFRESH_COOKIE];
    try {
      return this.respond(req, res, await this.auth.refresh(token));
    } catch (err) {
      this.clearCookie(res);
      throw err;
    }
  }

  @Public()
  @Get('invitations/:token')
  invitation(@Param('token') token: string): Promise<InvitationInfoDto> {
    return this.auth.invitationInfo(token);
  }

  /** Under /auth so the refresh cookie (path /auth) is set like at login. */
  @Public()
  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(req, res, await this.auth.acceptInvitation(token, body, this.meta(req)));
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @AllowPendingPasswordChange()
  changePassword(
    @CurrentUser() user: CurrentUserInfo,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<AuthUser> {
    return this.auth.changePassword(user, body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowPendingPasswordChange()
  async logout(
    @CurrentUser() user: CurrentUserInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user);
    this.clearCookie(res);
  }

  @Get('me')
  @AllowPendingPasswordChange()
  me(@CurrentUser() user: CurrentUserInfo): Promise<AuthUser> {
    return this.auth.me(user);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: CurrentUserInfo): Promise<SessionInfo[]> {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.auth.revokeSession(user, id);
  }

  private meta(req: Request): ClientMeta {
    return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
  }

  /** Web: refresh token in an httpOnly cookie. Native clients: in the body. */
  private respond(req: Request, res: Response, tokens: IssuedTokens): AuthResponse {
    const { refreshToken, ...rest } = tokens;
    if (req.get(CLIENT_TYPE_HEADER) === 'native') return { ...rest, refreshToken };
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: refreshCookiePath(this.config),
      maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
    });
    return rest;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: refreshCookiePath(this.config) });
  }
}

/** Sessions of the company (OWNER) or of the user: device, IP, last activity. */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserInfo): Promise<TenantSessionDto[]> {
    return this.auth.tenantSessions(user);
  }

  /** Own session, or any session of the company for the OWNER (lost phone). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.auth.revokeSession(user, id);
  }
}
