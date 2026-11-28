import { tenantContext } from '../common/tenant-context';
import { type Tx } from '../prisma/prisma.service';

/**
 * Serializes every write of zones and zone assignments of one company. The tenant row is
 * taken FOR NO KEY UPDATE: it queues with the user writes (which lock it too, and first) and
 * leaves the inserts of the rest of the app, which only share its key, running.
 */
export async function lockZones(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantContext.requireTenantId()}::uuid FOR NO KEY UPDATE`;
}
