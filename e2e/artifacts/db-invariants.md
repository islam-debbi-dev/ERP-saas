# db-invariants

Total 20 · PASS 19 · FAIL 1 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| database invariants | stock_equals_ledger | PASS |  |  |
| database invariants | stock_products_missing_cache | PASS |  |  |
| database invariants | stock_balance_chain | PASS |  |  |
| database invariants | client_balance_equals_ledger | PASS |  |  |
| database invariants | clients_missing_balance | PASS |  |  |
| database invariants | document_numbers_contiguous | PASS |  |  |
| database invariants | document_numbers_bad_format | PASS |  |  |
| database invariants | document_sequence_matches_usage | PASS |  |  |
| database invariants | ledger_tables_have_no_updated_at | PASS |  |  |
| database invariants | money_columns_are_numeric | PASS |  |  |
| database invariants | money_columns_wrong_scale | PASS |  |  |
| database invariants | business_tables_without_tenant | PASS |  |  |
| database invariants | composite_indexes_start_with_tenant | PASS |  |  |
| database invariants | deleted_at_only_on_master_data | PASS |  |  |
| database invariants | validated_sale_has_ledger_and_audit | PASS |  |  |
| database invariants | sale_operation_rows_share_created_at | FAIL |  | 17 violation(s): [{"id":"9f4926c5-b0f7-4a84-9cbb-2fcbabff0203","number":"BL-2026-000001","tenantId":"00000000-0000-4000-8000-00000000d3e0","movement_at":"2026-10-18T23:24:12.828Z","ledger_at":"2026-10-18T23:24:12.842Z","audit_at":"2026-10-18T23:24:12.857Z"},{"id":"9f4926c5-b0f7-4a84-9cbb-2fcbabff0203","number":"BL-2026-000001","tenantId":"00000000-0000-4000-8000-00000000d3e0","movement_at":"2026-10-18T23:24:12.828Z","ledger_at":"2026-10-18T23:24:12.844Z","audit_at":"2026-10-18T23:24:12.857Z"},{"id":"89675c56-523f-4503-973d-8c6560305a22","number":"BL-2026-000005","tenantId":"00000000-0000-4000-8000-00000000d3e0","movement_at":"2026-10-19T18:11:37.048Z","ledger_at":"2026-10-19T18:11:37.054Z","audit_at":"2026-10-19T18:11:37.083Z"},{"id":"89675c56-523f-4503-973d-8c6560305a22","number":"BL-2026-000005","tenantId":"00000000-0000-4000-8000-00000000d3e0","movement_at":"2026-10-19T18:11:37.048Z","ledger_at":"2026-10-19T18:11:37.059Z","audit_at":"2026-10-19T18:11:37.083Z"},{"id":"38a69062-148f-4f4f-bcc6-fafcbd711f48","number":"BL-2026-000006","tenantId":"00000000-0000-4000-8000-00000000d3e0","movement_at":"2026-10-21T12:51:02.105Z","ledger_at":"2026-10-21T12:51:02.125Z","audit_at":"2026-10-21T12:51:02.148Z"}] |
| database invariants | validated_purchase_has_movements_and_audit | PASS |  |  |
| database invariants | validated_payment_has_ledger_and_audit | PASS |  |  |
| database invariants | cancelled_sale_has_reversing_entries | PASS |  |  |
| database invariants | no_orphan_ledger_rows | PASS |  |  |