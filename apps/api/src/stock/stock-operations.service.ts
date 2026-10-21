import { Injectable } from '@nestjs/common';
import {
  Permission,
  type AdjustmentInput,
  type OpeningStockInput,
  StockMovementType,
  type StockOperationResult,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { requirePermission } from '../auth/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';
import { baseUnitCost, toBaseLines } from './unit-conversion';

/** Opening stock and manual adjustments (casse, perte...). */
@Injectable()
export class StockOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  /** One-time per product. Corrections afterwards go through adjustments. */
  async opening(input: OpeningStockInput): Promise<StockOperationResult> {
    return this.prisma.db.$transaction(async (tx) => {
      const converted = await toBaseLines(tx, input.lines);
      const result = await this.stock.applyMovements(
        tx,
        converted.map((c, i) => ({
          productId: c.productId,
          type: StockMovementType.OPENING,
          qtyBase: c.qtyBase,
          unitCost: baseUnitCost(input.lines[i]?.unitCost ?? '0', c.factorToBase),
          note: input.note ?? null,
        })),
      );
      await this.audit.log(tx, {
        action: 'STOCK_OPENING',
        entity: 'Stock',
        after: { lines: input.lines, movementIds: result.movementIds },
      });
      return { movements: result.movementIds.length, warnings: result.warnings };
    });
  }

  /** Positive lines add stock at the current CUMP; negative lines remove it. */
  async adjust(input: AdjustmentInput, user: CurrentUserInfo): Promise<StockOperationResult> {
    requirePermission(user, Permission.STOCK_ADJUST, { message: 'You may not adjust the stock' });
    return this.prisma.db.$transaction(async (tx) => {
      const converted = await toBaseLines(tx, input.lines);
      const result = await this.stock.applyMovements(
        tx,
        converted.map((c) => ({
          productId: c.productId,
          type: StockMovementType.ADJUSTMENT,
          qtyBase: c.qtyBase,
          reason: input.reason,
          note: input.note ?? null,
        })),
      );
      await this.audit.log(tx, {
        action: 'STOCK_ADJUSTED',
        entity: 'Stock',
        after: {
          reason: input.reason,
          note: input.note,
          lines: input.lines,
          movementIds: result.movementIds,
        },
      });
      return { movements: result.movementIds.length, warnings: result.warnings };
    });
  }
}
