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
  type AuthResponse,
  type AuthUser,
  CLIENT_TYPE_HEADER,
  type LoginInput,
  loginSchema,
  type RefreshInput,
  refreshSchema,
  type RegisterInput,
  registerSchema,
  type SessionInfo,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { type IssuedTokens, AuthService } from './auth.service';
import type { ClientMeta, CurrentUserInfo } from './auth.types';
import { CurrentUser, Public } from './decorators';

export const REFRESH_COOKIE = 'erp_rt';
const REFRESH_COOKIE_PATH = '/auth';

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

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: CurrentUserInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user);
    this.clearCookie(res);
  }

  @Get('me')
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
      path: REFRESH_COOKIE_PATH,
      maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
    });
    return rest;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }
}
