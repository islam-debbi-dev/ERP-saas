import { Injectable } from '@nestjs/common';
import { tenantContext } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

export interface VehicleBackfillResult {
  tenants: number;
  /** Visits that got the truck of their sale or of their order. */
  visits: number;
  /** Delivered orders that got the truck of their BL. */
  orders: number;
}

/**
 * One-off after the phase 36 deploy (docs/runbook.md, "Vehicle backfill"): puts the truck
 * on the visits and orders written before the column existed, from facts only.
 *
 * - `visits.vehicleId`: the dépôt of the linked sale when it is a truck (a van sale leaves
 *   from the seller's truck), else the truck frozen on the linked order.
 * - `orders.deliveryVehicleId`: the dépôt of the order's BL when it is a truck.
 *
 * What cannot be known stays null ("Véhicule inconnu"): never guessed from today's driver.
 * Only null columns are written, so a second run changes nothing.
 */
@Injectable()
export class VehicleBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  async run(options: { tenantIds?: string[] } = {}): Promise<VehicleBackfillResult> {
    const tenants = await tenantContext.runAsSystem(() =>
      this.prisma.db.tenant.findMany({
        where: options.tenantIds ? { id: { in: options.tenantIds } } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
    const result: VehicleBackfillResult = { tenants: tenants.length, visits: 0, orders: 0 };
    for (const { id } of tenants) {
      const r = await tenantContext.run({ tenantId: id }, () => this.tenant(id));
      result.visits += r.visits;
      result.orders += r.orders;
    }
    return result;
  }

  private async tenant(tenantId: string): Promise<{ visits: number; orders: number }> {
    return this.prisma.db.$transaction(async (tx) => {
      const orders = await tx.$executeRaw`
        UPDATE orders o SET "deliveryVehicleId" = w.id
        FROM sales s
        JOIN warehouses w ON w.id = s."warehouseId" AND w.type = 'VEHICLE'
        WHERE o."tenantId" = ${tenantId}::uuid AND o."deliveryVehicleId" IS NULL
          AND o."saleId" = s.id AND s."tenantId" = o."tenantId"`;
      // Visits are append-only for the application; this fills a column that did not
      // exist when they were written, and changes nothing a seller recorded.
      const visits = await tx.$executeRaw`
        UPDATE visits v SET "vehicleId" = k."vehicleId"
        FROM (
          SELECT v2.id, COALESCE(sw.id, o."vehicleId") AS "vehicleId"
          FROM visits v2
          LEFT JOIN sales s ON s.id = v2."saleId" AND s."tenantId" = v2."tenantId"
          LEFT JOIN warehouses sw ON sw.id = s."warehouseId" AND sw.type = 'VEHICLE'
          LEFT JOIN orders o ON o.id = v2."orderId" AND o."tenantId" = v2."tenantId"
          WHERE v2."tenantId" = ${tenantId}::uuid AND v2."vehicleId" IS NULL
        ) k
        WHERE v.id = k.id AND k."vehicleId" IS NOT NULL`;
      return { visits, orders };
    });
  }
}
