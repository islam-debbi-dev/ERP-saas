import { Injectable } from '@nestjs/common';
import {
  type ClientLedgerType,
  type CreditCheckResult,
  CreditLimitMode,
  ErrorCode,
  money,
  type Money,
  toMoneyString,
} from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';

export interface LedgerEntryInput {
  clientId: string;
  type: ClientLedgerType;
  /** Signed: + the client owes more, - the client owes less. */
  amount: string;
  /** Short description stored with the entry (document number, note...). */
  label: string;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** Only for imports of historical balances; defaults to now. */
  createdAt?: Date;
}

interface BalanceRow {
  balance: Money;
  hasOpening: boolean;
}

/**
 * The only way to change a client account (AGENTS.md rules 1 and 3). Sales,
 * versements and returns call `post` inside their own transaction; nothing else
 * writes client_ledger_entries or client_balances.
 */
@Injectable()
export class ClientAccountService {
  async post(tx: Tx, entries: LedgerEntryInput[]): Promise<Map<string, string>> {
    if (entries.length === 0) return new Map();
    const tenantId = tenantContext.requireTenantId();
    const userId = tenantContext.get()?.userId ?? null;
    const balances = await this.lock(
      tx,
      entries.map((e) => e.clientId),
    );

    for (const e of entries) {
      const row = balances.get(e.clientId);
      if (!row) throw new Error(`balance not locked for ${e.clientId}`);
      const amount = money(e.amount);
      if (amount.isZero()) throw new Error('A ledger entry cannot be zero');
      if (e.type === 'OPENING') {
        if (row.hasOpening) {
          throw new AppException(
            ErrorCode.CLIENT_OPENING_ALREADY_SET,
            'Opening balance already set',
            {
              clientId: e.clientId,
            },
          );
        }
        row.hasOpening = true;
      }
      row.balance = row.balance.plus(amount);
      await tx.clientLedgerEntry.create({
        data: {
          tenantId,
          clientId: e.clientId,
          type: e.type,
          amount: amount.toString(),
          label: e.label.slice(0, 160),
          reason: e.reason ?? null,
          refType: e.refType ?? null,
          refId: e.refId ?? null,
          createdBy: userId,
          ...(e.createdAt ? { createdAt: e.createdAt } : {}),
        },
      });
    }

    const result = new Map<string, string>();
    for (const [clientId, row] of balances) {
      await tx.clientBalance.update({
        where: { clientId },
        data: { balance: row.balance.toString(), hasOpening: row.hasOpening },
      });
      result.set(clientId, toMoneyString(row.balance));
    }
    return result;
  }

  /**
   * Would `additional` push the client over the plafond? Locks the balance row, so
   * the answer stays true until the caller's transaction posts the sale.
   */
  async checkCreditLimit(tx: Tx, clientId: string, additional: string): Promise<CreditCheckResult> {
    const row = (await this.lock(tx, [clientId])).get(clientId);
    if (!row) throw new Error('balance not locked');
    const client = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { creditLimit: true },
    });
    const projected = row.balance.plus(money(additional));
    const base = {
      balance: toMoneyString(row.balance),
      limit: client.creditLimit ? toMoneyString(client.creditLimit.toString()) : null,
      projected: toMoneyString(projected),
    };
    if (!client.creditLimit || projected.lte(client.creditLimit.toString()))
      return { status: 'OK', ...base };
    const { creditLimitMode } = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { creditLimitMode: true },
    });
    return { status: creditLimitMode === CreditLimitMode.BLOCK ? 'BLOCK' : 'WARN', ...base };
  }

  /**
   * Creates missing balance rows, then locks them in clientId order so two
   * transactions on the same clients never deadlock and the second waits.
   */
  private async lock(tx: Tx, clientIds: string[]): Promise<Map<string, BalanceRow>> {
    const tenantId = tenantContext.requireTenantId();
    const ids = [...new Set(clientIds)].sort();
    const clients = await tx.client.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (clients.length !== ids.length)
      throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    for (const clientId of ids) {
      await tx.$executeRaw`
        INSERT INTO client_balances ("id", "tenantId", "clientId", "updatedAt")
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${clientId}::uuid, CURRENT_TIMESTAMP)
        ON CONFLICT ("clientId") DO NOTHING`;
    }
    const rows = await tx.$queryRaw<
      { clientId: string; balance: Prisma.Decimal; hasOpening: boolean }[]
    >`
      SELECT "clientId", balance, "hasOpening" FROM client_balances
      WHERE "tenantId" = ${tenantId}::uuid
        AND "clientId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "clientId"
      FOR UPDATE`;
    return new Map(
      rows.map((r) => [
        r.clientId,
        { balance: money(r.balance.toString()), hasOpening: r.hasOpening },
      ]),
    );
  }
}
