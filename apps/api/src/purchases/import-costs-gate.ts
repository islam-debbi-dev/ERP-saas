import { Injectable } from '@nestjs/common';
import { ErrorCode, Feature } from '@erp/shared';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';

/**
 * The IMPORT_COSTS module (phase 22) seen from core screens: foreign currencies on
 * suppliers / BRs and dossiers d'importation. Off = everything behaves as before.
 */
@Injectable()
export class ImportCostsGate {
  constructor(private readonly features: FeaturesService) {}

  async enabled(tenantId: string = tenantContext.requireTenantId()): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.IMPORT_COSTS);
  }

  async require(): Promise<void> {
    if (!(await this.enabled())) {
      throw new AppException(ErrorCode.FEATURE_NOT_IN_PLAN, 'This module is not in your plan', {
        feature: Feature.IMPORT_COSTS,
      });
    }
  }
}
