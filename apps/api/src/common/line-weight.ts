import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../prisma/prisma.service';
import { tenantContext } from './tenant-context';

const TABLES = {
  sale: { table: 'sale_lines', parent: 'saleId' },
  transfer: { table: 'stock_transfer_lines', parent: 'transferId' },
} as const;

/**
 * Freezes the weight of a document's lines at validation (phase 37, rule 9): quantity in
 * base units × the product's weight now, 3 decimals half-up. A product without a weight
 * leaves the line's weight null ("poids inconnu"), never 0. Called in the transaction that
 * validates the document, right after its lines are written.
 */
export async function freezeLineWeights(
  tx: Tx,
  kind: keyof typeof TABLES,
  documentId: string,
): Promise<void> {
  const { table, parent } = TABLES[kind];
  const tenantId = tenantContext.requireTenantId();
  await tx.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)} l
    SET "weightKg" = ROUND(l."qtyBase" * p."weightKg", 3)
    FROM products p
    WHERE p.id = l."productId" AND p."tenantId" = l."tenantId"
      AND l."tenantId" = ${tenantId}::uuid
      AND l.${Prisma.raw(`"${parent}"`)} = ${documentId}::uuid
      AND p."weightKg" IS NOT NULL`;
}
