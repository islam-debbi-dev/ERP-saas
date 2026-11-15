-- Part D of test-36: the truth of the phase 36 backfill, read with SQL after the migration
-- and `db:backfill-vehicles` on the pre-36 copy (erp_t36_base). Every rule returns the rows
-- that break it: an empty result is a pass. Rules named info_* are counts to read, not rules.
-- Run by api/vehicles-backfill.ts (splits on the `-- rule:` lines); any rule runs alone in psql.

-- rule: assignment_missing_for_a_truck_with_a_driver
-- One 'backfill' row per live truck with a driver (spec: "one row per truck that has a driver today").
SELECT w.id, w.name, w."assignedUserId"
FROM warehouses w
WHERE w.type = 'VEHICLE' AND w."deletedAt" IS NULL AND w."assignedUserId" IS NOT NULL
  AND (SELECT count(*) FROM vehicle_assignments a WHERE a."vehicleId" = w.id AND a.reason = 'backfill') <> 1;

-- rule: assignment_backfill_row_wrong
-- The row names today's driver, starts at the truck's updatedAt, has nobody as setBy.
SELECT a.id, w.name, a."userId", w."assignedUserId", a."fromAt", w."updatedAt", a."setBy"
FROM vehicle_assignments a JOIN warehouses w ON w.id = a."vehicleId"
WHERE a.reason = 'backfill'
  AND (a."userId" IS DISTINCT FROM w."assignedUserId" OR a."fromAt" <> w."updatedAt"
       OR a."setBy" IS NOT NULL OR a."tenantId" <> w."tenantId");

-- rule: assignment_for_a_truck_that_should_have_none
-- No row for a truck without driver, an archived truck, or a dépôt that is not a truck.
SELECT a.id, w.name, w.type, w."deletedAt", w."assignedUserId"
FROM vehicle_assignments a JOIN warehouses w ON w.id = a."vehicleId"
WHERE a.reason = 'backfill'
  AND (w.type <> 'VEHICLE' OR w."deletedAt" IS NOT NULL OR w."assignedUserId" IS NULL);

-- rule: visit_vehicle_not_the_truck_its_sale_left
-- A visit linked to a sale that left a truck carries that truck.
SELECT v.id, v."vehicleId", s."warehouseId" AS sale_truck
FROM visits v JOIN sales s ON s.id = v."saleId" JOIN warehouses w ON w.id = s."warehouseId"
WHERE w.type = 'VEHICLE' AND v."vehicleId" IS DISTINCT FROM s."warehouseId";

-- rule: visit_vehicle_without_a_fact
-- A visit has a truck only when its sale left one or its order carries one: nothing guessed.
SELECT v.id, v."vehicleId", v."saleId", v."orderId"
FROM visits v
LEFT JOIN sales s ON s.id = v."saleId"
LEFT JOIN warehouses sw ON sw.id = s."warehouseId" AND sw.type = 'VEHICLE'
LEFT JOIN orders o ON o.id = v."orderId"
WHERE v."vehicleId" IS NOT NULL AND v."vehicleId" IS DISTINCT FROM COALESCE(sw.id, o."vehicleId");

-- rule: order_delivery_vehicle_not_its_bl_truck
-- A delivered order whose BL left a truck carries that truck.
SELECT o.id, o."deliveryVehicleId", s."warehouseId" AS bl_truck
FROM orders o JOIN sales s ON s.id = o."saleId" JOIN warehouses w ON w.id = s."warehouseId"
WHERE w.type = 'VEHICLE' AND o."deliveryVehicleId" IS DISTINCT FROM s."warehouseId";

-- rule: order_delivery_vehicle_without_a_fact
-- No delivery truck on an order without BL, or whose BL left a dépôt that is not a truck.
SELECT o.id, o.status, o."deliveryVehicleId", s."warehouseId" AS bl_depot
FROM orders o
LEFT JOIN sales s ON s.id = o."saleId"
LEFT JOIN warehouses w ON w.id = s."warehouseId" AND w.type = 'VEHICLE'
WHERE o."deliveryVehicleId" IS NOT NULL AND w.id IS NULL;

-- rule: vehicle_of_another_company
-- Every truck written by the backfill belongs to the row's company.
SELECT 'visit' AS t, v.id FROM visits v JOIN warehouses w ON w.id = v."vehicleId" WHERE w."tenantId" <> v."tenantId"
UNION ALL
SELECT 'order', o.id FROM orders o JOIN warehouses w ON w.id = o."deliveryVehicleId" WHERE w."tenantId" <> o."tenantId";

-- rule: info_visits_left_null_although_their_order_names_a_truck
-- Count, not a rule: visits linked to an order whose dépôt (or BL's dépôt) is a truck, still
-- without a truck because the fallback reads orders."vehicleId", null on every pre-36 order.
SELECT count(*) AS n
FROM visits v JOIN orders o ON o.id = v."orderId"
LEFT JOIN warehouses ow ON ow.id = o."warehouseId" AND ow.type = 'VEHICLE'
LEFT JOIN sales s ON s.id = o."saleId"
LEFT JOIN warehouses bw ON bw.id = s."warehouseId" AND bw.type = 'VEHICLE'
WHERE v."vehicleId" IS NULL AND COALESCE(ow.id, bw.id) IS NOT NULL;

-- rule: info_columns_filled
SELECT (SELECT count(*) FROM visits WHERE "vehicleId" IS NOT NULL) AS visits_with_truck,
       (SELECT count(*) FROM visits) AS visits,
       (SELECT count(*) FROM orders WHERE "deliveryVehicleId" IS NOT NULL) AS orders_with_delivery_truck,
       (SELECT count(*) FROM orders WHERE "vehicleId" IS NOT NULL) AS orders_with_truck,
       (SELECT count(*) FROM orders) AS orders,
       (SELECT count(*) FROM vehicle_assignments) AS assignments;
