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
  type InviteResultDto,
  type InviteUserInput,
  inviteUserSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  Role,
  type UpdateUserInput,
  updateUserSchema,
  type UserDto,
  type UserPermissionsInput,
  userPermissionsSchema,
  Feature,
  type TeamNodeDto,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';

/** Managers see the team; only the OWNER invites, changes roles and permissions. */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER)
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Post('invite')
  @Roles(Role.OWNER)
  invite(
    @Body(new ZodValidationPipe(inviteUserSchema)) body: InviteUserInput,
  ): Promise<InviteResultDto> {
    return this.users.invite(body);
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
  @Roles(Role.OWNER, Role.MANAGER)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @Put(':id')
  @Roles(Role.OWNER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserDto> {
    return this.users.update(id, body, user);
  }

  @Put(':id/permissions')
  @Roles(Role.OWNER)
  permissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userPermissionsSchema)) body: UserPermissionsInput,
  ): Promise<UserDto> {
    return this.users.setPermissions(id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<UserDto> {
    return this.users.deactivate(id, user);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER)
  reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.users.reactivate(id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<InviteResultDto> {
    return this.users.resetPassword(id, body, user);
  }
}
