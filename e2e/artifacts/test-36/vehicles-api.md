# vehicles-api

Total 109 · PASS 90 · FAIL 12 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| A1. Vehicle types | code of 1 and of 20 characters accepted, 21 refused with 400, empty refused | PASS |  |  |
| A1. Vehicle types | MXT then mxt in the same company: VEHICLE_CODE_TAKEN | PASS |  |  |
| A1. Vehicle types | the same code in another company is allowed | PASS |  |  |
| A1. Vehicle types | a code is compared as text: "_" and "%" are not wildcards (AB1 exists, A_1 is another code) | FAIL | spec: code is the owner's own text, unique "case-insensitive", nothing more | A_1 -> HTTP 409 {"code":"VEHICLE_CODE_TAKEN","message":"Code already used","details":{"field":"code"},"requestId":"b2c53a8d-14c1-4629-b7b3-f2ddfd45785f"} ; % -> HTTP 409 {"code":"VEHICLE_CODE_TAKEN","message":"Code already used","details":{"field":"code"},"requestId":"115f4237-72b2-49a3-bcd5-7451a3dd947a"} |
| A1. Vehicle types | archive refused while a live truck has the type (VEHICLE_TYPE_IN_USE), allowed once the truck is archived | PASS |  |  |
| A1. Vehicle types | an archived type is not listed, not usable on a new truck, and its code is free again | PASS |  |  |
| A1. Vehicle types | INFO inactive type: listed=true (active=false), usable on a new truck=true | INFO |  |  |
| A1. Vehicle types | a type switched off (active: false) but not archived: what the API does | PASS |  |  |
| A1. Vehicle types | activity outside the four, unknown field on update, codePrefix of 11: 400 | PASS |  |  |
| A1. Vehicle types | audit rows: one per write, with before / after | PASS |  |  |
| A1. Vehicle types | a SELLER (no SETTINGS_EDIT) reads the types and cannot write them | PASS |  |  |
| A2. Truck identity | code unique among the live dépôts and trucks of the company, whatever the case | PASS |  |  |
| A2. Truck identity | the code is free again once the first truck is archived | PASS |  |  |
| A2. Truck identity | a code is compared as text: "VAN_28 MXT 01" is not "VAN-28 MXT 01" ("_" is no wildcard) | FAIL | accepted: another code | HTTP 409 {"code":"VEHICLE_CODE_TAKEN","message":"Code already used","details":{"field":"code"},"requestId":"392eae43-637b-4d96-95ef-ed85815a779f"} |
| A2. Truck identity | identity fields on a new dépôt are refused with the code the spec names (VEHICLE_FIELDS_ON_DEPOT), as on update | FAIL | spec, API: error code VEHICLE_FIELDS_ON_DEPOT | POST /warehouses answers vehicleTypeId: HTTP 400 VALIDATION_FAILED ; wilayaCode: HTTP 400 VALIDATION_FAILED ; plateNumber: HTTP 400 VALIDATION_FAILED ; capacityKg: HTTP 400 VALIDATION_FAILED (PATCH answers VEHICLE_FIELDS_ON_DEPOT) |
| A2. Truck identity | identity fields refused on a dépôt on update, one by one (VEHICLE_FIELDS_ON_DEPOT); a code is allowed | PASS |  |  |
| A2. Truck identity | the database refuses them too (CHECK), written as the app role | PASS |  |  |
| A2. Truck identity | wilaya 0 and 70 refused, 1 and 69 accepted; a string, a float refused | PASS |  |  |
| A2. Truck identity | capacityKg 0, -1, a float and huge values refused with 400; 1 and 1 000 000 accepted | PASS |  |  |
| A2. Truck identity | plate of 20 accepted, 21 refused; code of 30 accepted, 31 refused | PASS |  |  |
| A2. Truck identity | the owner's text is kept as typed: Arabic, inner spaces, slash, lower case | PASS |  |  |
| A2. Truck identity | list filters: type, wilaya, search on code / name / plate | PASS |  |  |
| A2. Truck identity | the search box takes "%" and "_" as text (no truck has either in its code, name or plate) | FAIL | a search on text | ?search=% returns 17 of 17 dépôts; ?search=N_2 returns 2 rows that do not hold "N_2" (e.g. "VAN-28 MXT 01") |
| A2. Truck identity | code helper: the lowest free number, gaps filled (01, 02, 04 taken -> 03) | PASS |  |  |
| A2. Truck identity | code helper: what it proposes is always free and fits (100 trucks of one type and wilaya, long prefix) | FAIL | a free code of at most 30 characters ending with a number | first proposal "PPPPPPPPPP-28 TTTTTTTTTTTTT 01"; with 01..99 taken it proposes "PPPPPPPPPP-28 TTTTTTTTTTTTT" (no number: the form would offer the same text for every further truck) |
| A2. Truck identity | audit: the identity is in the after of WAREHOUSE_CREATED and in before / after of WAREHOUSE_UPDATED | PASS |  |  |
| A3. Driver change | one row per change, written with who and why; the same driver again writes nothing | PASS |  |  |
| A3. Driver change | moving a driver who has another truck frees it: two rows, in one go | PASS |  |  |
| A3. Driver change | userId null leaves the truck without a driver (one row naming nobody) | PASS |  |  |
| A3. Driver change | who may be put on a truck: a seller and a livreur, not a storekeeper, not an unknown user | PASS |  |  |
| A3. Driver change | who may call it: owner, manager, supervisor (his team); a seller, a livreur, a storekeeper get 403 | PASS |  |  |
| A3. Driver change | the dépôt form (PATCH assignedUserId) still refuses a driver who has a truck: VEHICLE_ALREADY_ASSIGNED | PASS |  |  |
| A3. Driver change | a failure after the history row rolls everything back: no row, no driver, no audit | PASS |  |  |
| A3. Driver change | an open SellerSession of the driver on the truck blocks the change (SESSION_OPEN_ON_VEHICLE), whoever's turn it is | PASS |  |  |
| A3. Driver change | every path writes its row: create with a driver, PATCH set / clear, archive, quick-assign | PASS |  |  |
| A3. Driver change | deactivating a user who drives a truck frees the truck (a row naming nobody), or is refused | FAIL | spec: "every change of assignedUserId writes a row"; a truck is driven by a live user (assignDriver refuses a deleted one) | deactivate -> HTTP 200; warehouses.assignedUserId is still the deactivated user; history rows: 1 (last userId 0db270c7-359a-4780-be65-397a1312e559). GET /warehouses shows him as today's driver: {"id":"0db270c7-359a-4780-be65-397a1312e559","fullName":"A2 SELLER mwhmpypbi"} |
| A3. Driver change | changing a driver to a role that cannot drive (STOREKEEPER) frees the truck, or is refused | FAIL | DRIVING_ROLES = selling roles + LIVREUR (packages/shared/src/enums.ts) | PUT role STOREKEEPER -> HTTP 200; the storekeeper is still assignedUserId of truck DEMO (assignDriver answers SELLER_NOT_ALLOWED for that role) |
| A3. Driver change | SQL truth: for every truck of the company the last history row names today's driver | PASS |  |  |
| A4. History helpers and the worker history | driverAt / vehicleAt across three changes: at the exact fromAt, one millisecond before, between, in the future | PASS |  |  |
| A4. History helpers and the worker history | A: truck 1 -> truck 2 -> truck 2 given to B: A has two closed periods with the right dates, B one open | PASS |  |  |
| A4. History helpers and the worker history | who reads it: the worker himself and the owner; another seller gets 403; an unknown user 404 | PASS |  |  |
| A4. History helpers and the worker history | cursor pagination of the worker history is stable while new changes are written | PASS |  |  |
| A4. History helpers and the worker history | cursor pagination of a truck's history (GET /warehouses/:id/assignments): the same walk | PASS |  |  |
| A4. History helpers and the worker history | a truck outside the reader's dépôts appears by its code with inReach false | PASS |  |  |
| A5. vehicle_assignments is append-only | UPDATE and DELETE refused by the trigger as the app role (erp_app) | PASS |  |  |
| A5. vehicle_assignments is append-only | UPDATE and DELETE refused by the trigger as the owner role (erp) | PASS |  |  |
| A5. vehicle_assignments is append-only | TRUNCATE: refused to the app role | PASS |  |  |
| A5. vehicle_assignments is append-only | INFO TRUNCATE as the owner role (rolled back): accepted: the row trigger does not cover TRUNCATE | INFO |  |  |
| A5. vehicle_assignments is append-only | the app role inserts only for its own company (RLS), and the rows are all still there | PASS |  |  |
| A6. Tournées per vehicle | a route planned for a truck stores sellerId null, even when a seller is sent with it | PASS |  |  |
| A6. Tournées per vehicle | a route with neither a truck nor a seller is refused: ROUTE_NEEDS_OWNER in the API, routes_owner_check in the database | PASS |  |  |
| A6. Tournées per vehicle | aujourd'hui (GET /me/today): the truck's route for its driver, with the truck named; nothing for the others | PASS |  |  |
| A6. Tournées per vehicle | right after the driver change, with no route edit: the new driver has the tournée, the previous one no longer | PASS |  |  |
| A6. Tournées per vehicle | INFO after the change, the new driver's day shows visited 0 / 2 (the truck's first stop was visited today by the previous driver: visitedToday=false) | INFO |  |  |
| A6. Tournées per vehicle | the stops B sees on the truck's tournée say what the truck already did today (A visited one before the change) | PASS |  |  |
| A6. Tournées per vehicle | convert one: SELLER_HAS_NO_VEHICLE when the seller drives none; the route is left as it was | PASS |  |  |
| A6. Tournées per vehicle | convert one: the route takes its seller's truck of now, loses its seller, is audited; a second convert changes nothing | PASS |  |  |
| A6. Tournées per vehicle | bulk convert: the count, the routes of sellers without a truck skipped, a second run converts 0, one audit row per route | PASS |  |  |
| A6. Tournées per vehicle | list filters: ?vehicleId= gives the routes of that truck, ?sellerId= the old seller routes | PASS |  |  |
| A7. The truck frozen on visits and orders | Visit.vehicleId = the truck the seller drives when it starts; a seller without a truck: null | PASS |  |  |
| A7. The truck frozen on visits and orders | a visit typed in for a moment before he had the truck gets no truck (history, never today's driver) | PASS |  |  |
| A7. The truck frozen on visits and orders | Order.vehicleId = the truck of the prévendeur when the order is taken | PASS |  |  |
| A7. The truck frozen on visits and orders | a later driver change rewrites neither the visit nor the order | PASS |  |  |
| A7. The truck frozen on visits and orders | a correction visit copies the truck of the visit it replaces, not the truck of today | PASS |  |  |
| A7. The truck frozen on visits and orders | the visits table refuses an UPDATE of the frozen truck through the API (no route) and the list filters by truck | PASS |  |  |
| A7. The truck frozen on visits and orders | assigning a delivery truck puts the order on the truck and on its driver of today ("Mes livraisons") | PASS |  |  |
| A7. The truck frozen on visits and orders | the driver changes before delivery: the order follows the truck, the new driver has it, the old one no longer | PASS |  |  |
| A7. The truck frozen on visits and orders | delivery by the new driver: deliveryVehicleId and livreurId say what and who delivered, the cash is his | PASS |  |  |
| A7. The truck frozen on visits and orders | the BL of an order put on a loaded delivery truck leaves that truck (the order was taken by a seller, who named no dépôt) | FAIL | spec: "the truck that delivered it … (the BL's dépôt when it is a truck)"; domain: a truck is a dépôt with its own stock, chargement and déchargement | the 6 units left the dépôt principal: delivery truck 100.000 -> 100.000 (100 were loaded on it), dépôt principal 1900.000 -> 1894.000; Order.deliveryVehicleId = the truck. The order got warehouseId = the dépôt principal when the seller took it, though he sent none (ScopeService.onlyWarehouse) |
| A7. The truck frozen on visits and orders | an order whose dépôt is the delivery truck itself (taken by the office): the BL leaves the truck | PASS |  |  |
| A7. The truck frozen on visits and orders | later driver changes do not rewrite a delivered order | PASS |  |  |
| A7. The truck frozen on visits and orders | an order delivered from the dépôt principal by the office has no delivery truck; list filter ?deliveryVehicleId= | PASS |  |  |
| A7. The truck frozen on visits and orders | INFO POST /visits with startedAt 30 days from now: HTTP 201 , vehicleId = today's truck | INFO |  |  |
| A7. The truck frozen on visits and orders | a visit dated in the future: what the API does | PASS |  |  |
| A8. Stock and money after a driver change | before any change: a sale with no dépôt chosen leaves the truck the seller drives | PASS |  |  |
| A8. Stock and money after a driver change | the day opened on truck 1 names truck 1; the move to truck 2 waits for the clôture | PASS |  |  |
| A8. Stock and money after a driver change | after the change (critical): the sale takes its stock from the truck he drives now, not the old one, not the dépôt principal | PASS |  |  |
| A8. Stock and money after a driver change | the visit of that sale freezes the same truck as the sale left | PASS |  |  |
| A8. Stock and money after a driver change | INFO a seller naming a truck he no longer drives (warehouseId = old truck): HTTP 201  | INFO |  |  |
| A8. Stock and money after a driver change | he can still name his old truck or the dépôt (what phase 15 allowed), and what he names is what moves | PASS |  |  |
| A8. Stock and money after a driver change | chargement and déchargement after the change: the goods move between the named dépôts, the CUMP stays | PASS |  |  |
| A8. Stock and money after a driver change | cash responsibility after the move: the second truck of his day has a clôture too (the guard that protects it needs an open one) | FAIL | spec: "close the day first, money responsibility must stay clear" — one clôture per seller per day (phase 16) leaves the second truck of the day without one | POST /seller-sessions again -> HTTP 201, the same closed session (true). Cash collected by the seller today: 8000.00 DA; counted in his clôtures: 5000 DA; sessions of the day: [{"status":"CLOSED","truck":"S1","expected":"5000.00"}]. No session names truck S2: the afternoon on the second truck has no clôture, and he can be taken off S2 with that cash in hand: POST /warehouses/S2/driver {userId: null} -> HTTP 200. |
| A8. Stock and money after a driver change | INFO seller with an OPEN day (opened before he got the truck, session.warehouseId null) and cash in hand is taken off his truck: HTTP 200 (allowed: the guard only looks at sessions that name the truck) | INFO |  |  |
| A8. Stock and money after a driver change | a day opened before the seller had a truck (no truck on the session) does not block a later change | PASS |  |  |
| A8. Stock and money after a driver change | a truck switched off (active: false) with its driver still on it: the sale and its visit agree on the truck | FAIL | one truck for the sale, the visit and the order of the same seller at the same moment (phase 37 reads Visit.vehicleId as the truck of the sale) | after PATCH active:false (assignedUserId kept: true, history rows: 1, last names the seller: true): the sale left the dépôt principal (truck stock 30.000, dépôt principal 1967.000), Visit.vehicleId = truck X1, Order.vehicleId = null, GET /me/today vehicle = null |
| A9. Livreurs drive trucks; the activity is only a hint | a livreur is put on a DELIVERY truck (new decision), through the quick change and through the form | PASS |  |  |
| A9. Livreurs drive trucks; the activity is only a hint | the livreur delivers an order from his truck (an order whose dépôt is the truck) | PASS |  |  |
| A9. Livreurs drive trucks; the activity is only a hint | INFO livreur on a truck: POST /sales/quick -> 403 FORBIDDEN; naming his truck -> 403 FORBIDDEN; POST /orders -> 403 FORBIDDEN; POST /visits -> 403 FORBIDDEN | INFO |  |  |
| A9. Livreurs drive trucks; the activity is only a hint | the livreur cannot sell from his truck: the existing rules (who may create a sale) still decide | PASS |  |  |
| A9. Livreurs drive trucks; the activity is only a hint | activity is a hint: the driver of a PRESALE truck still sells from its stock, takes orders, and is loaded and unloaded | PASS |  |  |
| A9. Livreurs drive trucks; the activity is only a hint | activity is a hint: a seller on a DELIVERY truck sells from it; a route may be planned for any truck; orders are assigned to a CASH_VAN or PRESALE truck | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | driver_matches_last_history_row | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | history_only_on_trucks_of_the_same_company | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | one_live_truck_per_driver | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | history_never_goes_back_on_a_truck | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | archived_truck_has_no_driver | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | driver_is_a_live_user_who_may_drive | FAIL |  | 6 row(s) break the rule, e.g. [{"tenantId":"57abe86b-13d2-4566-8359-099827a1c28c","vehicle_id":"1a8517fb-12ca-4b0c-8a33-43d77326f824","code":"GONE","user_id":"389288c7-dd68-4cdd-bf32-706e4494e15c","role":"SELLER","user_archived_at":"2026-11-15T09:22:12.774Z"},{"tenantId":"57abe86b-13d2-4566-8359-099827a1c28c","vehicle_id":"98982ae8-a6a5-49fb-a365-3b4181459e42","code":"DEMO","user_id":"5f077d24-a210-436c-b213-8da79384657c","role":"STOREKEEPER","user_archived_at":null}] |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | identity_fields_only_on_trucks | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | truck_type_is_a_type_of_the_same_company | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | live_truck_has_a_live_type | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | live_codes_are_unique_per_company_whatever_the_case | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | route_has_an_owner_and_a_vehicle_route_no_seller | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | frozen_trucks_are_trucks_of_the_same_company | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | visit_truck_is_the_truck_its_seller_had_then | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | visit_sale_left_the_truck_frozen_on_the_visit | FAIL |  | 3 row(s) break the rule, e.g. [{"visit_id":"61d3e008-7abd-4ed6-85f4-75447391a809","tenantId":"e9060233-2105-425c-9c89-e235efa79d84","visit_truck":"6cb8f1f2-5e4d-4ef9-bc39-9136c47001ed","sale_left_from":"2b43c2ad-acb5-40ab-935d-912a280de811","sale_depot_type":"MAIN","number":"BL-2026-000001"},{"visit_id":"3f64d0f4-ac43-4025-8f04-3725395e1293","tenantId":"b483d6dd-5f8c-4b48-8aa6-e8e2a60186a4","visit_truck":"e3d18718-2a3d-4513-a474-050474411743","sale_left_from":"e4b0cbb3-ff9e-4abb-95fa-c890bff8beb2","sale_depot_type":"MAIN","number":"BL-2026-000001"}] |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | delivered_order_truck_is_where_its_bl_left_from | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | truck_stock_equals_its_movements | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | dépôts_sum_to_the_product_level | PASS |  |  |
| A10. After the whole scenario: the database, read with SQL (sql/vehicles-history.sql) | pnpm --filter @erp/api reconcile on the same database: no difference | PASS |  |  |