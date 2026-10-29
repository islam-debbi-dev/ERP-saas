import { Injectable } from '@nestjs/common';
import { money, PurchaseStatus, SupplierLedgerType } from '@erp/shared';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { lockPurchase } from './purchases.service';
import { SupplierAccountService, type SupplierEntryInput } from './supplier-account.service';

export interface BackfillResult {
  tenants: number;
  purchases: number;
  returns: number;
}

/**
 * One-off (phase 21): posts the supplier ledger entries of the bons de réception
 * validated before supplier accounts existed, so balances are right from day one.
 * Idempotent: a BR or a retour that already has an entry is skipped, so running it
 * twice changes nothing. Safe with the API running: each BR is locked like a cancel
 * or a return would lock it. A cancelled BR posts nothing (its net effect is zero, and
 * a cancel after the deploy reverses only what is on the account).
 */
@Injectable()
export class SupplierBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: SupplierAccountService,
  ) {}

  async run(): Promise<BackfillResult> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    const result: BackfillResult = { tenants: tenants.length, purchases: 0, returns: 0 };
    for (const t of tenants) {
      const counts = await tenantContext.run({ tenantId: t.id }, () => this.tenant());
      result.purchases += counts.purchases;
      result.returns += counts.returns;
    }
    return result;
  }

  private async tenant(): Promise<{ purchases: number; returns: number }> {
    const ids = await this.prisma.db.purchase.findMany({
      where: { status: PurchaseStatus.VALIDATED },
      select: { id: true },
      orderBy: { validatedAt: 'asc' },
    });
    let purchases = 0;
    let returns = 0;
    for (const { id } of ids) {
      const done = await this.prisma.db.$transaction(async (tx) => {
        const current = await lockPurchase(tx, id);
        if (current.status !== PurchaseStatus.VALIDATED) return { purchase: false, returns: 0 };
        const purchase = await tx.purchase.findUniqueOrThrow({
          where: { id },
          include: { returns: { orderBy: { createdAt: 'asc' } } },
        });
        const posted = await tx.supplierLedgerEntry.findMany({
          where: {
            OR: [
              { refType: 'Purchase', refId: id },
              { refType: 'PurchaseReturn', refId: { in: purchase.returns.map((r) => r.id) } },
            ],
          },
          select: { refType: true, refId: true },
        });
        const has = new Set(posted.map((p) => `${p.refType}:${p.refId}`));
        const at = purchase.validatedAt ?? purchase.createdAt;
        const label = purchase.number ?? '';
        const entries: SupplierEntryInput[] = [];
        const total = money(purchase.totalTtc.toString());
        const paid = money(purchase.paidAmount.toString());
        const postPurchase = !has.has(`Purchase:${id}`);
        if (postPurchase) {
          const base = { supplierId: purchase.supplierId, label, refType: 'Purchase', refId: id };
          if (total.gt(0)) {
            entries.push({
              ...base,
              type: SupplierLedgerType.PURCHASE,
              amount: total.toString(),
              createdAt: at,
            });
          }
          if (paid.gt(0)) {
            entries.push({
              ...base,
              type: SupplierLedgerType.PAYMENT,
              amount: paid.negated().toString(),
              reason: 'paid_at_reception',
              createdAt: at,
            });
          }
        }
        const missingReturns = purchase.returns.filter(
          (r) => !has.has(`PurchaseReturn:${r.id}`) && money(r.totalTtc.toString()).gt(0),
        );
        for (const r of missingReturns) {
          entries.push({
            supplierId: purchase.supplierId,
            type: SupplierLedgerType.RETURN,
            amount: money(r.totalTtc.toString()).negated().toString(),
            label: r.number,
            refType: 'PurchaseReturn',
            refId: r.id,
            createdAt: r.createdAt,
          });
        }
        await this.account.post(tx, entries);
        return {
          purchase: postPurchase && entries.length > missingReturns.length,
          returns: missingReturns.length,
        };
      });
      if (done.purchase) purchases += 1;
      returns += done.returns;
    }
    return { purchases, returns };
  }
}
