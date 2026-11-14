# db-invariants

Total 70 · PASS 68 · FAIL 2 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| database invariants | stock_equals_ledger | PASS |  |  |
| database invariants | stock_products_missing_cache | PASS |  |  |
| database invariants | warehouse_sum_equals_product | PASS |  |  |
| database invariants | warehouse_stock_equals_ledger | PASS |  |  |
| database invariants | stock_balance_chain | PASS |  |  |
| database invariants | client_balance_equals_ledger | PASS |  |  |
| database invariants | supplier_balance_equals_ledger | PASS |  |  |
| database invariants | suppliers_missing_balance | PASS |  |  |
| database invariants | clients_missing_balance | PASS |  |  |
| database invariants | employee_balances_equal_ledgers | PASS |  |  |
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
| database invariants | sale_operation_rows_share_created_at | FAIL |  | 458 violation(s): [{"id":"d3028e4f-c88c-4b24-aeff-b09c0dc8871e","number":"BL-2026-000001","tenantId":"54d387a8-c3c2-448c-af3a-804f867b26c6","movement_at":"2026-11-13T22:50:57.735Z","ledger_at":"2026-11-13T22:50:57.743Z","audit_at":"2026-11-13T22:50:57.856Z"},{"id":"d3028e4f-c88c-4b24-aeff-b09c0dc8871e","number":"BL-2026-000001","tenantId":"54d387a8-c3c2-448c-af3a-804f867b26c6","movement_at":"2026-11-13T22:50:57.735Z","ledger_at":"2026-11-13T22:50:57.757Z","audit_at":"2026-11-13T22:50:57.856Z"},{"id":"14eed306-d40c-4a05-8e23-ca5521cbfc1e","number":"BL-2026-000002","tenantId":"54d387a8-c3c2-448c-af3a-804f867b26c6","movement_at":"2026-11-13T22:50:58.418Z","ledger_at":"2026-11-13T22:50:58.426Z","audit_at":"2026-11-13T22:50:58.486Z"},{"id":"14eed306-d40c-4a05-8e23-ca5521cbfc1e","number":"BL-2026-000002","tenantId":"54d387a8-c3c2-448c-af3a-804f867b26c6","movement_at":"2026-11-13T22:50:58.418Z","ledger_at":"2026-11-13T22:50:58.428Z","audit_at":"2026-11-13T22:50:58.486Z"},{"id":"3adcccb3-f6e7-4570-bbe1-e85c6b9ea3c8","number":"BL-2026-000001","tenantId":"df9337d0-a498-45ca-8592-d54d66f5d329","movement_at":"2026-11-13T22:52:41.478Z","ledger_at":"2026-11-13T22:52:41.489Z","audit_at":"2026-11-13T22:52:41.844Z"}] |
| database invariants | validated_purchase_has_movements_and_audit | PASS |  |  |
| database invariants | validated_payment_has_ledger_and_audit | PASS |  |  |
| database invariants | cancelled_sale_has_reversing_entries | PASS |  |  |
| database invariants | no_orphan_ledger_rows | PASS |  |  |
| database invariants | packaging_balance_equals_ledger | PASS |  |  |
| database invariants | cash_balance_equals_ledger | PASS |  |  |
| database invariants | employee_matricules_contiguous | PASS |  |  |
| database invariants | supplier_currency_balance_equals_ledger | PASS |  |  |
| database invariants | ledger_rows_missing_cached_balance | PASS |  |  |
| database invariants | ledger_tables_are_append_only | PASS |  |  |
| database invariants | ledger_like_tables_without_append_only_trigger | FAIL |  | 1 violation(s): [{"table_name":"payment_allocations"}] |
| database invariants | tenant_tables_without_rls | PASS |  |  |
| database invariants | rls_policies_not_bound_to_the_tenant | PASS |  |  |
| database invariants | tenant_tables_without_tenant_leading_index | PASS |  |  |
| database invariants | float_columns | PASS |  |  |
| database invariants | numeric_columns_of_an_unknown_shape | PASS |  |  |
| database invariants | money_named_columns_outside_14_2 | PASS |  |  |
| database invariants | quantity_named_columns_outside_14_3 | PASS |  |  |
| database invariants | sale_totals_equal_their_lines | PASS |  |  |
| database invariants | sale_stock_movements_equal_their_lines | PASS |  |  |
| database invariants | stock_transfer_movements_sum_to_zero | PASS |  |  |
| database invariants | negative_stock_while_blocked | PASS |  |  |
| database invariants | cash_transfer_movements_sum_to_zero | PASS |  |  |
| database invariants | money_documents_move_their_account_exactly_once | PASS |  |  |
| database invariants | payslips_add_up | PASS |  |  |
| database invariants | payroll_paid_more_than_due | PASS |  |  |
| database invariants | payroll_runs_live_twice_or_badly_numbered | PASS |  |  |
| database invariants | salary_posted_twice | PASS |  |  |
| database invariants | order_lines_deliver_more_than_ordered | PASS |  |  |
| database invariants | idempotency_keys_used_twice | PASS |  |  |
| database invariants | rows_pointing_at_another_tenant | PASS |  |  |
| append-only ledgers (live probe, rolled back) | stock_movements: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | stock_movements: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | client_ledger_entries: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | client_ledger_entries: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | supplier_ledger_entries: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | supplier_ledger_entries: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | employee_ledger_entries: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | employee_ledger_entries: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | cash_movements: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | cash_movements: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | leave_entries: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | leave_entries: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | client_packaging_entries: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | client_packaging_entries: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | audit_logs: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | audit_logs: DELETE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | attendance_events: UPDATE of an existing row is refused | PASS |  |  |
| append-only ledgers (live probe, rolled back) | attendance_events: DELETE of an existing row is refused | PASS |  |  |