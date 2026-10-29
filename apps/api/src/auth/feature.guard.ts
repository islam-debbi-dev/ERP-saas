import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { editionsWith, ErrorCode, type Feature } from '@erp/shared';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import type { AuthenticatedRequest } from './auth.types';
import { ADMIN_ROUTE_KEY, FEATURE_KEY, IS_PUBLIC_KEY } from './decorators';

/** Runs after JwtAuthGuard. Only checks routes decorated with @RequireFeature(...). */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, targets);
    if (!feature) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ROUTE_KEY, targets)) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { edition, features } = await this.features.of(user.tenantId);
    if (!features.includes(feature)) {
      throw new AppException(ErrorCode.FEATURE_NOT_IN_PLAN, 'This module is not in your plan', {
        feature,
        edition,
        editions: editionsWith(feature),
      });
    }
    return true;
  }
}
