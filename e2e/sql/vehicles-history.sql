-- Test 36 (vehicle-first distribution): what must hold in the database after any scenario,
-- whatever the API did. Each block returns the rows that break the rule: none = it holds.
-- Read as the owner role, over every company of the database.
--   DB=postgresql://erp:erp@localhost:5432/erp_t36 pnpm test:vehicles:api   (runs them last)

-- name: driver_matches_last_history_row
-- Spec, "Crew history": every change of assignedUserId writes a row, so for every truck the
-- last row of vehicle_assignments names today's driver (no row at all = never had one).
SELECT w."tenantId", w.id AS vehicle_id, w.code, w."assignedUserId" AS driver_now,
       l."userId" AS last_row_user, l."fromAt" AS last_row_from
FROM warehouses w
LEFT JOIN LATERAL (
  SELECT a."userId", a."fromAt" FROM vehicle_assignments a
  WHERE a."vehicleId" = w.id
  ORDER BY a."fromAt" DESC, a."createdAt" DESC, a.id DESC
  LIMIT 1) l ON true
WHERE w.type = 'VEHICLE' AND w."assignedUserId" IS DISTINCT FROM l."userId";

-- name: history_only_on_trucks_of_the_same_company
SELECT a.id, a."tenantId", a."vehicleId", w.type, w."tenantId" AS vehicle_tenant
FROM vehicle_assignments a
JOIN warehouses w ON w.id = a."vehicleId"
LEFT JOIN users u ON u.id = a."userId"
WHERE w.type <> 'VEHICLE' OR w."tenantId" <> a."tenantId"
   OR (u.id IS NOT NULL AND u."tenantId" <> a."tenantId");

-- name: one_live_truck_per_driver
SELECT w."tenantId", w."assignedUserId", count(*) AS trucks, array_agg(w.code) AS codes
FROM warehouses w
WHERE w.type = 'VEHICLE' AND w."deletedAt" IS NULL AND w."assignedUserId" IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;

-- name: history_never_goes_back_on_a_truck
-- "The last row" is only the truth when two rows of one truck never share a fromAt.
SELECT a."vehicleId", a."fromAt", count(*) AS n
FROM vehicle_assignments a GROUP BY 1, 2 HAVING count(*) > 1;

-- name: archived_truck_has_no_driver
SELECT w."tenantId", w.id, w.code, w."assignedUserId"
FROM warehouses w
WHERE w.type = 'VEHICLE' AND w."deletedAt" IS NOT NULL AND w."assignedUserId" IS NOT NULL;

-- name: driver_is_a_live_user_who_may_drive
-- DRIVING_ROLES (packages/shared/src/enums.ts): the selling roles and LIVREUR.
SELECT w."tenantId", w.id AS vehicle_id, w.code, u.id AS user_id, u.role, u."deletedAt" AS user_archived_at
FROM warehouses w
JOIN users u ON u.id = w."assignedUserId"
WHERE w.type = 'VEHICLE' AND w."deletedAt" IS NULL
  AND (u."deletedAt" IS NOT NULL OR u.role NOT IN ('OWNER', 'MANAGER', 'SUPERVISOR', 'SELLER', 'LIVREUR'));

-- name: identity_fields_only_on_trucks
SELECT w.id, w.type, w."vehicleTypeId", w."wilayaCode", w."plateNumber", w."capacityKg"
FROM warehouses w
WHERE w.type <> 'VEHICLE'
  AND (w."vehicleTypeId" IS NOT NULL OR w."wilayaCode" IS NOT NULL
       OR w."plateNumber" IS NOT NULL OR w."capacityKg" IS NOT NULL);

-- name: truck_type_is_a_type_of_the_same_company
SELECT w.id, w."tenantId", t."tenantId" AS type_tenant
FROM warehouses w JOIN vehicle_types t ON t.id = w."vehicleTypeId"
WHERE t."tenantId" <> w."tenantId";

-- name: live_truck_has_a_live_type
-- VEHICLE_TYPE_IN_USE: a type a live truck still has cannot be archived.
SELECT w.id, w.code, t.code AS type_code, t."deletedAt"
FROM warehouses w JOIN vehicle_types t ON t.id = w."vehicleTypeId"
WHERE w."deletedAt" IS NULL AND t."deletedAt" IS NOT NULL;

-- name: live_codes_are_unique_per_company_whatever_the_case
SELECT 'warehouse' AS what, "tenantId", lower(code) AS code, count(*) AS n
FROM warehouses WHERE code IS NOT NULL AND "deletedAt" IS NULL GROUP BY 2, 3 HAVING count(*) > 1
UNION ALL
SELECT 'vehicle_type', "tenantId", lower(code), count(*)
FROM vehicle_types WHERE "deletedAt" IS NULL GROUP BY 2, 3 HAVING count(*) > 1;

-- name: route_has_an_owner_and_a_vehicle_route_no_seller
SELECT r.id, r."tenantId", r."vehicleId", r."sellerId"
FROM routes r
WHERE (r."vehicleId" IS NULL AND r."sellerId" IS NULL)
   OR (r."vehicleId" IS NOT NULL AND r."sellerId" IS NOT NULL);

-- name: frozen_trucks_are_trucks_of_the_same_company
SELECT 'route' AS what, r.id, r."vehicleId" FROM routes r JOIN warehouses w ON w.id = r."vehicleId"
WHERE w.type <> 'VEHICLE' OR w."tenantId" <> r."tenantId"
UNION ALL
SELECT 'visit', v.id, v."vehicleId" FROM visits v JOIN warehouses w ON w.id = v."vehicleId"
WHERE w.type <> 'VEHICLE' OR w."tenantId" <> v."tenantId"
UNION ALL
SELECT 'order', o.id, o."vehicleId" FROM orders o JOIN warehouses w ON w.id = o."vehicleId"
WHERE w.type <> 'VEHICLE' OR w."tenantId" <> o."tenantId"
UNION ALL
SELECT 'order delivery', o.id, o."deliveryVehicleId" FROM orders o JOIN warehouses w ON w.id = o."deliveryVehicleId"
WHERE w.type <> 'VEHICLE' OR w."tenantId" <> o."tenantId";

-- name: visit_truck_is_the_truck_its_seller_had_then
-- Spec, "Freeze the truck": Visit.vehicleId = the truck the seller drives at startedAt, from
-- the history only. A correction copies the visit it replaces, so it is left out. Since the
-- fix of C-1 a visit linked to a sale of its seller names the dépôt that sale left (rule
-- visit_sale_left_the_truck_frozen_on_the_visit), so it is left out here too.
SELECT v.id, v."tenantId", v."sellerId", v."startedAt", v."vehicleId" AS frozen, h."vehicleId" AS from_history
FROM visits v
LEFT JOIN LATERAL (
  SELECT a."vehicleId" FROM vehicle_assignments a
  WHERE a."tenantId" = v."tenantId" AND a."userId" = v."sellerId" AND a."fromAt" <= v."startedAt"
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_assignments n
      WHERE n."vehicleId" = a."vehicleId" AND n."fromAt" <= v."startedAt"
        AND (n."fromAt", n."createdAt", n.id) > (a."fromAt", a."createdAt", a.id))
  ORDER BY a."fromAt" DESC, a."createdAt" DESC, a.id DESC
  LIMIT 1) h ON true
WHERE v."correctsVisitId" IS NULL AND v."vehicleId" IS DISTINCT FROM h."vehicleId"
  AND NOT EXISTS (
    SELECT 1 FROM sales s
    WHERE s.id = v."saleId" AND s."sellerId" = v."sellerId" AND s."warehouseId" IS NOT NULL);

-- name: visit_sale_left_the_truck_frozen_on_the_visit
-- Phase 37 reads Visit.vehicleId as "the truck this sale was made with". When the sale of a
-- visit left a truck, it must be that one; when the visit has a truck, the sale must not
-- have left another dépôt.
SELECT v.id AS visit_id, v."tenantId", v."vehicleId" AS visit_truck, s."warehouseId" AS sale_left_from,
       sw.type AS sale_depot_type, s.number
FROM visits v
JOIN sales s ON s.id = v."saleId"
JOIN warehouses sw ON sw.id = s."warehouseId"
WHERE s."sellerId" = v."sellerId"
  AND ((sw.type = 'VEHICLE' AND v."vehicleId" IS DISTINCT FROM s."warehouseId")
    OR (sw.type <> 'VEHICLE' AND v."vehicleId" IS NOT NULL));

-- name: delivered_order_truck_is_where_its_bl_left_from
-- Spec: Order.deliveryVehicleId = the BL's dépôt when it is a truck.
SELECT o.id, o."tenantId", o.number, o."deliveryVehicleId", s."warehouseId" AS bl_left_from, w.type
FROM orders o
JOIN sales s ON s.id = o."saleId"
JOIN warehouses w ON w.id = s."warehouseId"
WHERE o.status = 'DELIVERED' AND w.type = 'VEHICLE' AND o."deliveryVehicleId" IS DISTINCT FROM s."warehouseId";

-- name: truck_stock_equals_its_movements
SELECT ws."tenantId", ws."warehouseId", w.code, ws."productId", ws."qtyBase" AS cached_qty,
       COALESCE(SUM(sm."qtyBase"), 0) AS ledger_qty
FROM warehouse_stocks ws
JOIN warehouses w ON w.id = ws."warehouseId"
LEFT JOIN stock_movements sm
  ON sm."tenantId" = ws."tenantId" AND sm."productId" = ws."productId"
 AND (sm."warehouseId" = ws."warehouseId" OR (w."isDefault" AND sm."warehouseId" IS NULL))
GROUP BY ws."tenantId", ws."warehouseId", w.code, ws."productId", ws."qtyBase"
HAVING ws."qtyBase" <> COALESCE(SUM(sm."qtyBase"), 0);

-- name: dépôts_sum_to_the_product_level
SELECT ps."tenantId", ps."productId", ps."qtyBase" AS cached_qty, SUM(ws."qtyBase") AS split_qty
FROM product_stocks ps
JOIN warehouse_stocks ws ON ws."tenantId" = ps."tenantId" AND ws."productId" = ps."productId"
JOIN warehouses w ON w.id = ws."warehouseId"
GROUP BY ps."tenantId", ps."productId", ps."qtyBase"
HAVING bool_or(w."isDefault") AND ps."qtyBase" <> SUM(ws."qtyBase");
