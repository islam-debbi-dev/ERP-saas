import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  Feature,
  type InviteResultDto,
  type InviteUserInput,
  inviteUserSchema,
  Permission,
  type ResetPasswordInput,
  resetPasswordSchema,
  Role,
  type TeamNodeDto,
  type UpdateUserInput,
  updateUserSchema,
  type UserAccessDto,
  type UserAccessInput,
  userAccessSchema,
  type UserDto,
  type UserPermissionsInput,
  userPermissionsSchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UserAccessService } from './user-access.service';
import { UsersService } from './users.service';

/**
 * Managers see the team; the OWNER (or USERS_MANAGE, phase 24) invites, changes roles and
 * permissions.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly access: UserAccessService,
  ) {}

  @Get()
  @RequirePermission(Permission.USERS_VIEW)
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Post('invite')
  @RequirePermission(Permission.USERS_MANAGE)
  invite(
    @Body(new ZodValidationPipe(inviteUserSchema)) body: InviteUserInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InviteResultDto> {
    return this.users.invite(body, user);
  }

  /** Active users who can be a sale's seller (phase 14, core): the seller pickers. */
  @Get('sellers')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
  sellers(
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<{ id: string; fullName: string; role: Role }[]> {
    return this.users.sellers(user);
  }

  /** The hierarchy as a tree (phase 14); a supervisor sees his own team. */
  @Get('team')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
  @RequireFeature(Feature.SALES_FORCE)
  team(@CurrentUser() user: CurrentUserInfo): Promise<TeamNodeDto[]> {
    return this.users.team(user);
  }

  @Get(':id')
  @RequirePermission(Permission.USERS_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @Put(':id')
  @RequirePermission(Permission.USERS_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserDto> {
    return this.users.update(id, body, user);
  }

  @Put(':id/permissions')
  @RequirePermission(Permission.USERS_MANAGE)
  permissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userPermissionsSchema)) body: UserPermissionsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserDto> {
    return this.users.setPermissions(id, body, user);
  }

  /** The dépôts this user works in or sees figures of (phase 24). */
  @Get(':id/access')
  @RequirePermission(Permission.USERS_VIEW)
  @RequireFeature(Feature.MULTI_UNIT)
  getAccess(@Param('id', ParseUUIDPipe) id: string): Promise<UserAccessDto> {
    return this.access.get(id);
  }

  /** Replaces his dépôts; never beyond the granter's own reach (ACCESS_ABOVE_GRANTER). */
  @Put(':id/access')
  @RequirePermission(Permission.WAREHOUSE_ACCESS_MANAGE)
  @RequireFeature(Feature.MULTI_UNIT)
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userAccessSchema)) body: UserAccessInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserAccessDto> {
    return this.access.set(id, body, user);
  }

  @Post(':id/deactivate')
  @RequirePermission(Permission.USERS_MANAGE)
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserDto> {
    return this.users.deactivate(id, user);
  }

  @Post(':id/reactivate')
  @RequirePermission(Permission.USERS_MANAGE)
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserDto> {
    return this.users.reactivate(id, user);
  }

  @Post(':id/reset-password')
  @RequirePermission(Permission.USERS_MANAGE)
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InviteResultDto> {
    return this.users.resetPassword(id, body, user);
  }
}
