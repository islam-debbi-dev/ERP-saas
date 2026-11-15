# test-36 part D, backfill

- **PASS** the phase 36 migration is applied on the pre-36 copy  
  last migration: 20261114232622_vehicle_first_distribution
- **PASS** one 'backfill' row for T1, seller3 today  
  [{"userId":"81c84720-3500-46ac-af96-5de77d07eda6","reason":"backfill","same":true,"setBy":null}]
- **PASS** one 'backfill' row for T2, seller2  
  [{"userId":"82433645-0816-4b8d-845b-f74c0eeb5ac3","reason":"backfill","same":true,"setBy":null}]
- **PASS** one 'backfill' row for T3, seller1 today  
  [{"userId":"74cdecb8-5792-47b8-a965-e5b49440934e","reason":"backfill","same":true,"setBy":null}]
- **PASS** one 'backfill' row for T5 switched off, driver kept  
  [{"userId":"dae302dd-b50d-4ce9-be4f-01576f84f628","reason":"backfill","same":true,"setBy":null}]
- **PASS** one 'backfill' row for Q1, company Q  
  [{"userId":"b40bb816-bd7f-4d17-87ef-1369a910d95e","reason":"backfill","same":true,"setBy":null}]
- **PASS** no row for T4 archived  
  0 row(s)
- **PASS** no row for Q2 no driver  
  0 row(s)
- **PASS** no row for dépôt principal  
  0 row(s)
- **PASS** before the backfill no visit or order has a truck  
  {"v":"0","o":"0"}
- **PASS** run 1 counts: every visit of a van sale, every order whose BL left a truck, nothing else  
  CLI: visits 25002, orders 3; SQL facts: visits 25002, orders 3; 2004 ms over 2+ tenants
- **PASS** visit_van_sale: visits.vehicleId = the truck of the facts  
  sale 31148675-3697-4642-aacc-9b57605c8b2c left T1; seller1 drives T3 today; got 6c36edde-0994-4be4-af50-461fb313e53f
- **PASS** visit_van_sale: visits.vehicleId = the truck of the facts  
  sale 3f960829-18e1-45a3-a3e3-67f381b6aab2 left T1; seller1 drives T3 today; got 6c36edde-0994-4be4-af50-461fb313e53f
- **PASS** visit_sale_from_main: visits.vehicleId = null  
  the sale left the dépôt principal; seller3 drives T1 today; got null
- **PASS** order_bl_from_truck: orders.deliveryVehicleId = the truck of the facts  
  order dépôt T1, BL left T1; got 6c36edde-0994-4be4-af50-461fb313e53f
- **PASS** order_no_depot_delivered_by_driver: orders.deliveryVehicleId = the truck of the facts  
  order dépôt none; BL left VEHICLE 6c36edde-0994-4be4-af50-461fb313e53f; got 6c36edde-0994-4be4-af50-461fb313e53f
- **PASS** order_prevente_bl_from_his_truck: orders.deliveryVehicleId = the truck of the facts  
  order dépôt T2, BL left T2; got ed054916-d2bc-4e78-9b9a-ac9f94d2be73
- **PASS** visit_order_on_his_truck: visits.vehicleId = null  
  order dépôt T2, BL left T2; orders.vehicleId is null on every pre-36 row; got null; a human could prove ed054916-d2bc-4e78-9b9a-ac9f94d2be73 from the rows
- **PASS** order_bl_from_main: orders.deliveryVehicleId = null  
  BL left the dépôt principal; got null
- **PASS** visit_order_on_main: visits.vehicleId = null  
  order on the dépôt principal; seller2 drives T2 today; got null
- **PASS** order_not_delivered: orders.deliveryVehicleId = null  
  confirmed, not delivered; got null
- **PASS** visit_neither: visits.vehicleId = null  
  no sale, no order; seller1 drove T1 then, drives T3 today; got null; a human could prove 6c36edde-0994-4be4-af50-461fb313e53f from the rows
- **PASS** visit_neither: visits.vehicleId = null  
  no sale, no order; seller1 drove T1 then, drives T3 today; got null; a human could prove 6c36edde-0994-4be4-af50-461fb313e53f from the rows
- **PASS** SQL assignment_missing_for_a_truck_with_a_driver  
  no row
- **PASS** SQL assignment_backfill_row_wrong  
  no row
- **PASS** SQL assignment_for_a_truck_that_should_have_none  
  no row
- **PASS** SQL visit_vehicle_not_the_truck_its_sale_left  
  no row
- **PASS** SQL visit_vehicle_without_a_fact  
  no row
- **PASS** SQL order_delivery_vehicle_not_its_bl_truck  
  no row
- **PASS** SQL order_delivery_vehicle_without_a_fact  
  no row
- **PASS** SQL vehicle_of_another_company  
  no row
- **INFO** SQL info_visits_left_null_although_their_order_names_a_truck  
  [{"n":"1"}]
- **INFO** SQL info_columns_filled  
  [{"visits_with_truck":"25002","visits":"50007","orders_with_delivery_truck":"3","orders_with_truck":"0","orders":"50005","assignments":"5"}]
- **PASS** run 2 changes 0 and 0  
  visits 0, orders 0
- **PASS** run 2 leaves every visit / order truck column as run 1 left it  
  md5 86a51b7ee07c6adaf9b4785556529a05
- **PASS** reconcile after migration and backfill  
  [32m[Nest] 41949  - [39m15/11/2026, 6:57:04 pm [32m    LOG[39m [38;5;3m[Reconcile] [39m[32mLedgers reconciled: no difference[39m | Ledgers reconciled: no difference.

36 checks · 34 passed · 0 failed · 2 info
