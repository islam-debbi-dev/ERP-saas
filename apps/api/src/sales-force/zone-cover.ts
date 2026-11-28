import { zoneCommuneCodes } from '@erp/shared/communes';
import { type PrismaService, type Tx } from '../prisma/prisma.service';

/** What communes zones and zone assignments cover today (phase 40b). Reads only. */
type Db = PrismaService['db'] | Tx;

const union = (lists: number[][]): number[] => [...new Set(lists.flat())].sort((a, b) => a - b);

/** The communes of the live zones this user is responsible for. */
export async function responsibleCommunes(db: Db, userId: string): Promise<number[]> {
  const zones = await db.fieldZone.findMany({
    where: { responsibleUserId: userId, deletedAt: null },
    select: { wilayaCodes: true, communeCodes: true },
  });
  return union(zones.map(zoneCommuneCodes));
}

/** The communes these users are assigned to now. Nobody assigned: no commune. */
export async function currentAssignmentCommunes(db: Db, userIds: string[]): Promise<number[]> {
  const rows = await db.sellerZoneAssignment.findMany({
    where: { userId: { in: userIds }, validTo: null },
    select: { communeCodes: true, zoneId: true },
  });
  const zoneIds = rows.flatMap((r) => (r.zoneId ? [r.zoneId] : []));
  const zones = zoneIds.length
    ? await db.fieldZone.findMany({
        where: { id: { in: zoneIds }, deletedAt: null },
        select: { wilayaCodes: true, communeCodes: true },
      })
    : [];
  return union([...rows.map((r) => r.communeCodes), ...zones.map(zoneCommuneCodes)]);
}
