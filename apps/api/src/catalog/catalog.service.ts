import { Injectable } from '@nestjs/common';
import { type Tx } from '../prisma/prisma.service';
import { createDefaultUnits, ensurePriceLevels } from './catalog-defaults';

/** Entry point other modules use to set up or adjust a tenant's catalog. */
@Injectable()
export class CatalogService {
  /** Called inside the registration transaction. */
  async initTenant(tx: Tx, tenantId: string, priceLevelCount: number): Promise<void> {
    await createDefaultUnits(tx, tenantId);
    await ensurePriceLevels(tx, tenantId, priceLevelCount);
  }

  /** Called inside the settings transaction when priceLevelCount changes. */
  async ensurePriceLevels(tx: Tx, tenantId: string, count: number): Promise<void> {
    await ensurePriceLevels(tx, tenantId, count);
  }
}
