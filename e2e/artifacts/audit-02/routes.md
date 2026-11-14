# API routes (352), read from the controllers

## apps/api/src/admin/admin.controller.ts

- `POST /admin/auth/login` (login, line 76) @AdminPublic() @HttpCode(HttpStatus.OK)
- `POST /admin/auth/refresh` (refresh, line 88) @AdminPublic() @HttpCode(HttpStatus.OK)
- `POST /admin/auth/logout` (logout, line 109) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /admin/auth/me` (me, line 119) 
- `GET /admin/assistant/config` (config, line 148) 
- `PUT /admin/assistant/config` (save, line 153) 
- `POST /admin/assistant/config/test` (test, line 161) @HttpCode(HttpStatus.OK)
- `GET /admin/assistant/usage` (usage, line 169) 
- `GET /admin/payroll-rate-sets` (list, line 182) 
- `POST /admin/payroll-rate-sets` (append, line 187) 
- `GET /admin/tenants` (list, line 200) 
- `GET /admin/tenants/:id` (detail, line 207) 
- `POST /admin/tenants/:id/payments` (recordPayment, line 212) 
- `PATCH /admin/tenants/:id/subscription` (update, line 229) 
- `PATCH /admin/tenants/:id/ai-key` (setAiKey, line 239) @HttpCode(HttpStatus.NO_CONTENT)
- `POST /admin/tenants/:id/impersonate` (impersonate, line 249) @HttpCode(HttpStatus.OK)

## apps/api/src/assistant/assistant.controllers.ts

- `GET /assistant/status` (status, line 54) 
- `POST /assistant/chat` (chat, line 63) @RequireFeature(Feature.AI_ASSISTANT) @RequirePermission(Permission.USE_ASSISTANT) @UseGuards(AssistantThrottlerGuard)
- `GET /assistant/conversations` (conversations, line 94) @RequireFeature(Feature.AI_ASSISTANT) @RequirePermission(Permission.USE_ASSISTANT)
- `GET /assistant/conversations/:id` (conversation, line 105) @RequireFeature(Feature.AI_ASSISTANT) @RequirePermission(Permission.USE_ASSISTANT)
- `DELETE /assistant/conversations/:id` (deleteConversation, line 115) @HttpCode(HttpStatus.NO_CONTENT) @RequireFeature(Feature.AI_ASSISTANT) @RequirePermission(Permission.USE_ASSISTANT)
- `POST /assistant/messages/:id/feedback` (feedback, line 126) @HttpCode(HttpStatus.NO_CONTENT) @RequireFeature(Feature.AI_ASSISTANT) @RequirePermission(Permission.USE_ASSISTANT)
- `GET /assistant/config` (get, line 146) 
- `PUT /assistant/config` (save, line 151) 
- `POST /assistant/config/test` (test, line 159) @HttpCode(HttpStatus.OK)

## apps/api/src/audit/audit-logs.controller.ts

- `GET /audit-logs` (list, line 14) 
- `GET /audit-logs/facets` (facets, line 22) 

## apps/api/src/auth/auth.controller.ts

- `POST /auth/register` (register, line 52) @Public()
- `POST /auth/login` (login, line 62) @Public() @HttpCode(HttpStatus.OK)
- `POST /auth/refresh` (refresh, line 73) @Public() @HttpCode(HttpStatus.OK)
- `GET /auth/invitations/:token` (invitation, line 91) @Public()
- `POST /auth/invitations/:token/accept` (acceptInvitation, line 98) @Public() @HttpCode(HttpStatus.OK)
- `POST /auth/password` (changePassword, line 109) @AllowWhenSuspended() @HttpCode(HttpStatus.OK) @AllowPendingPasswordChange()
- `POST /auth/logout` (logout, line 120) @AllowWhenSuspended() @HttpCode(HttpStatus.NO_CONTENT) @AllowPendingPasswordChange()
- `GET /auth/me` (me, line 132) @AllowPendingPasswordChange()
- `GET /auth/sessions` (sessions, line 138) 
- `DELETE /auth/sessions/:id` (revokeSession, line 143) @AllowWhenSuspended() @HttpCode(HttpStatus.NO_CONTENT)
- `GET /sessions` (list, line 181) 
- `DELETE /sessions/:id` (revoke, line 187) @AllowWhenSuspended() @HttpCode(HttpStatus.NO_CONTENT)

## apps/api/src/billing/billing.controller.ts

- `GET /tenant/subscription` (summary, line 11) 

## apps/api/src/catalog/catalog.controllers.ts

- `GET /units` (list, line 54) @RequirePermission(Permission.PRODUCTS_VIEW)
- `POST /units` (create, line 60) @RequirePermission(Permission.PRODUCTS_CREATE)
- `GET /price-levels` (list, line 71) @RequirePermission(Permission.PRODUCTS_VIEW)
- `PATCH /price-levels/:id` (rename, line 77) @RequirePermission(Permission.PRODUCTS_EDIT)
- `GET /categories` (tree, line 91) @RequirePermission(Permission.PRODUCTS_VIEW)
- `POST /categories` (create, line 97) @RequirePermission(Permission.PRODUCTS_CREATE)
- `PATCH /categories/:id` (update, line 105) @RequirePermission(Permission.PRODUCTS_EDIT)
- `DELETE /categories/:id` (remove, line 114) @RequirePermission(Permission.PRODUCTS_EDIT) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /brands` (list, line 127) @RequirePermission(Permission.PRODUCTS_VIEW)
- `POST /brands` (create, line 133) @RequirePermission(Permission.PRODUCTS_CREATE)
- `PATCH /brands/:id` (update, line 141) @RequirePermission(Permission.PRODUCTS_EDIT)
- `DELETE /brands/:id` (archive, line 150) @RequirePermission(Permission.PRODUCTS_EDIT) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /products` (list, line 162) @RequirePermission(Permission.PRODUCTS_VIEW)
- `GET /products/by-barcode/:code` (byBarcode, line 171) @RequirePermission(Permission.PRODUCTS_VIEW)
- `GET /products/:id` (get, line 177) @RequirePermission(Permission.PRODUCTS_VIEW)
- `POST /products` (create, line 183) @RequirePermission(Permission.PRODUCTS_CREATE)
- `PATCH /products/:id` (update, line 191) @RequirePermission(Permission.PRODUCTS_EDIT)
- `POST /products/:id/archive` (archive, line 200) @RequirePermission(Permission.PRODUCTS_EDIT) @HttpCode(HttpStatus.OK)
- `POST /products/:id/restore` (restore, line 207) @RequirePermission(Permission.PRODUCTS_EDIT) @HttpCode(HttpStatus.OK)

## apps/api/src/clients/client-location.controller.ts

- `PATCH /clients/:id/location` (set, line 30) @Roles(...FIELD_AND_OFFICE)
- `POST /clients/:id/location-requests` (request, line 40) @Roles(...FIELD_AND_OFFICE)
- `GET /location-requests` (list, line 56) 
- `POST /location-requests/:id/approve` (approve, line 64) @Roles(...DECIDERS)
- `POST /location-requests/:id/reject` (reject, line 73) @Roles(...DECIDERS)

## apps/api/src/clients/clients.controller.ts

- `GET /clients` (list, line 76) @RequirePermission(Permission.CLIENTS_VIEW)
- `GET /clients/map` (map, line 86) @RequirePermission(Permission.CLIENTS_VIEW) @RequireFeature(Feature.GEO_CHECK) @Header('Cache-Control', 'private, max-age=30')
- `POST /clients/nearby` (nearbyByBody, line 103) @HttpCode(200) @AllowWhenSuspended() @RequirePermission(Permission.CLIENTS_VIEW) @RequireFeature(Feature.GEO_CHECK)
- `GET /clients/nearby` (nearby, line 120) @RequirePermission(Permission.CLIENTS_VIEW) @RequireFeature(Feature.GEO_CHECK)
- `GET /clients/debtors` (debtors, line 131) @RequirePermission(Permission.CLIENTS_VIEW)
- `PATCH /clients/bulk-assign` (bulkAssign, line 141) @Roles(...MANAGERS) @RequireFeature(Feature.SALES_FORCE)
- `GET /clients/to-remind` (toRemind, line 151) @Roles(...MANAGERS)
- `GET /clients/reconcile` (reconcile, line 157) @Roles(Role.OWNER)
- `GET /clients/:id` (get, line 163) @RequirePermission(Permission.CLIENTS_VIEW)
- `GET /clients/:id/statement` (statement, line 172) @RequirePermission(Permission.CLIENTS_VIEW)
- `POST /clients` (create, line 182) @RequirePermission(Permission.CLIENTS_CREATE)
- `PATCH /clients/:id` (update, line 191) @RequirePermission(Permission.CLIENTS_EDIT)
- `DELETE /clients/:id` (archive, line 201) @RequirePermission(Permission.CLIENTS_ARCHIVE) @HttpCode(HttpStatus.NO_CONTENT)
- `POST /clients/:id/opening-balance` (openingBalance, line 208) @RequirePermission(Permission.CLIENTS_BALANCE_ADJUST) @Idempotent()
- `POST /clients/:id/adjustments` (adjust, line 219) @RequirePermission(Permission.CLIENTS_BALANCE_ADJUST) @Idempotent()

## apps/api/src/expenses/expenses.controllers.ts

- `GET /expense-categories` (list, line 63) 
- `POST /expense-categories` (create, line 70) @RequirePermission(Permission.RENT_MANAGE)
- `PUT /expense-categories/:id` (rename, line 78) @RequirePermission(Permission.RENT_MANAGE)
- `DELETE /expense-categories/:id` (archive, line 87) @RequirePermission(Permission.RENT_MANAGE) @HttpCode(HttpStatus.NO_CONTENT)
- `POST /expense-categories/:id/restore` (restore, line 94) @RequirePermission(Permission.RENT_MANAGE) @HttpCode(HttpStatus.OK)
- `GET /expenses` (list, line 109) 
- `GET /expenses/:id` (get, line 117) 
- `POST /expenses` (create, line 125) @RequirePermission(Permission.EXPENSES_CREATE) @Idempotent()
- `POST /expenses/:id/cancel` (cancel, line 135) @RequirePermission(Permission.EXPENSE_CANCEL) @Idempotent() @HttpCode(HttpStatus.OK)
- `GET /rent-contracts` (list, line 155) 
- `GET /rent-contracts/:id` (get, line 163) 
- `GET /rent-contracts/:id/schedule` (schedule, line 171) 
- `POST /rent-contracts` (create, line 179) @RequirePermission(Permission.RENT_MANAGE)
- `PATCH /rent-contracts/:id` (update, line 188) @RequirePermission(Permission.RENT_MANAGE)
- `POST /rent-contracts/:id/close` (close, line 198) @RequirePermission(Permission.RENT_MANAGE) @HttpCode(HttpStatus.OK)

## apps/api/src/geo/geo-checks.controller.ts

- `GET /geo-checks` (list, line 39) @Roles(...VIEWERS)
- `GET /geo-checks/report` (report, line 49) @Roles(...VIEWERS)
- `GET /geo-checks/:id` (get, line 58) @Roles(...VIEWERS)
- `POST /geo-checks/:id/review` (review, line 67) @Roles(...MANAGERS) @HttpCode(HttpStatus.OK)

## apps/api/src/health/health.controller.ts

- `GET /health` (check, line 19) @Public()

## apps/api/src/hr/hr.controllers.ts

- `GET /employees` (list, line 97) 
- `GET /employees/:id` (get, line 105) 
- `POST /employees` (create, line 113) @RequirePermission(Permission.HR_MANAGE)
- `PUT /employees/:id` (update, line 122) @RequirePermission(Permission.HR_MANAGE)
- `DELETE /employees/:id` (archive, line 132) @RequirePermission(Permission.HR_MANAGE) @HttpCode(HttpStatus.NO_CONTENT)
- `POST /employees/:id/restore` (restore, line 142) @RequirePermission(Permission.HR_MANAGE) @HttpCode(HttpStatus.OK)
- `GET /employees/:id/salaries` (salaries, line 152) @RequirePermission(Permission.SALARY_VIEW)
- `POST /employees/:id/salaries` (appendSalary, line 161) @RequirePermission(Permission.SALARY_VIEW) @Idempotent()
- `GET /employees/:id/ledger` (ledger, line 173) @RequirePermission(Permission.SALARY_VIEW)
- `GET /employees/:id/leave-balance` (leaveBalance, line 183) 
- `POST /employees/:id/leave-entries` (leaveEntry, line 191) @RequirePermission(Permission.LEAVE_APPROVE) @Idempotent()
- `POST /employees/:id/advances` (advance, line 202) @RequirePermission(Permission.ADVANCE_PAY) @Idempotent()
- `GET /attendance/day` (day, line 220) @RequirePermission(Permission.HR_VIEW)
- `GET /attendance/today` (today, line 229) @RequirePermission(Permission.HR_VIEW)
- `GET /attendance/month` (month, line 235) @RequirePermission(Permission.HR_VIEW)
- `GET /attendance/month/export.xlsx` (export, line 244) @RequirePermission(Permission.EXPORT_DATA)
- `POST /attendance/events` (mark, line 259) @RequirePermission(Permission.ATTENDANCE_MARK) @Idempotent()
- `POST /attendance/corrections` (correct, line 269) @RequirePermission(Permission.ATTENDANCE_CORRECT) @Idempotent()
- `GET /attendance/me` (mine, line 279) 
- `POST /attendance/check-in` (checkIn, line 284) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /attendance/check-out` (checkOut, line 294) @Idempotent() @HttpCode(HttpStatus.OK)
- `GET /leave-requests` (list, line 311) @RequirePermission(Permission.HR_VIEW)
- `POST /leave-requests` (create, line 320) @Idempotent()
- `POST /leave-requests/:id/approve` (approve, line 329) @RequirePermission(Permission.LEAVE_APPROVE) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /leave-requests/:id/reject` (reject, line 340) @RequirePermission(Permission.LEAVE_APPROVE) @HttpCode(HttpStatus.OK)
- `POST /leave-requests/:id/cancel` (cancel, line 351) @Idempotent() @HttpCode(HttpStatus.OK)
- `GET /hr-settings` (get, line 370) 
- `PUT /hr-settings` (update, line 375) @RequirePermission(Permission.HR_MANAGE)
- `GET /public-holidays` (list, line 390) 
- `POST /public-holidays` (create, line 397) @RequirePermission(Permission.HR_MANAGE)
- `PUT /public-holidays/:id` (update, line 405) @RequirePermission(Permission.HR_MANAGE)
- `DELETE /public-holidays/:id` (remove, line 414) @RequirePermission(Permission.HR_MANAGE) @HttpCode(HttpStatus.NO_CONTENT)

## apps/api/src/import-files/import-files.controller.ts

- `GET /import-files` (list, line 46) 
- `GET /import-files/:id` (get, line 53) 
- `GET /import-files/:id/preview` (preview, line 59) 
- `POST /import-files` (create, line 64) @Idempotent()
- `PUT /import-files/:id` (update, line 72) 
- `POST /import-files/:id/cancel` (cancel, line 80) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /import-files/:id/purchases` (attach, line 90) @HttpCode(HttpStatus.OK)
- `DELETE /import-files/:id/purchases/:purchaseId` (detach, line 99) 
- `POST /import-files/:id/costs` (addCost, line 107) @Idempotent()
- `POST /import-files/:id/costs/:costId/cancel` (cancelCost, line 117) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /import-files/:id/close` (close, line 128) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /import-files/:id/late-cost` (lateCost, line 135) @Idempotent()

## apps/api/src/imports/imports.controller.ts

- `GET /imports` (list, line 44) 
- `GET /imports/templates/:type` (template, line 51) 
- `POST /imports/:type/preview` (preview, line 66) @HttpCode(HttpStatus.OK) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1 } }),)
- `POST /imports/:id/confirm` (confirm, line 80) @Idempotent() @HttpCode(HttpStatus.OK)

## apps/api/src/incentives/incentives.controllers.ts

- `GET /sales-targets` (list, line 59) @Roles(...MANAGERS, Role.SUPERVISOR)
- `PUT /sales-targets/bulk` (bulk, line 68) @Roles(...MANAGERS)
- `GET /incentive-plans` (list, line 84) 
- `POST /incentive-plans` (create, line 89) 
- `GET /incentive-plans/:id` (get, line 97) 
- `PATCH /incentive-plans/:id` (update, line 102) 
- `POST /incentive-plans/:id/rules` (addRule, line 110) 
- `PUT /incentive-plans/:id/rules/:ruleId` (updateRule, line 119) 
- `DELETE /incentive-plans/:id/rules/:ruleId` (removeRule, line 129) 
- `POST /incentive-plans/:id/activate` (activate, line 137) @HttpCode(HttpStatus.OK)
- `POST /incentive-plans/:id/new-version` (newVersion, line 143) 
- `POST /incentive-plans/:id/archive` (archive, line 152) @HttpCode(HttpStatus.OK)
- `GET /incentive-runs` (list, line 165) 
- `POST /incentive-runs` (preview, line 173) @HttpCode(HttpStatus.OK)
- `GET /incentive-runs/:id` (get, line 182) 
- `POST /incentive-runs/:id/approve` (approve, line 190) @HttpCode(HttpStatus.OK)
- `GET /incentive-runs/:id/export.xlsx` (export, line 199) 
- `GET /me/objectives` (mine, line 220) 

## apps/api/src/packaging/packaging.controllers.ts

- `GET /packaging-types` (list, line 44) @Roles(...FIELD, Role.STOREKEEPER)
- `POST /packaging-types` (create, line 50) @Roles(...MANAGERS) @RequireFeature(Feature.PACKAGING)
- `PUT /packaging-types/:id` (update, line 59) @Roles(...MANAGERS) @RequireFeature(Feature.PACKAGING)
- `DELETE /packaging-types/:id` (archive, line 69) @Roles(...MANAGERS) @RequireFeature(Feature.PACKAGING) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /clients/:id/packaging` (ofClient, line 83) @Roles(...FIELD)
- `GET /products/:id/packaging` (ofProduct, line 93) @Roles(...FIELD, Role.STOREKEEPER)
- `PUT /products/:id/packaging` (setProduct, line 99) @Roles(...MANAGERS) @RequireFeature(Feature.PACKAGING)
- `POST /packaging-movements` (move, line 109) @Idempotent() @Roles(...FIELD) @RequireFeature(Feature.PACKAGING)

## apps/api/src/payments/payments.controllers.ts

- `GET /payments` (list, line 42) @RequirePermission(Permission.PAYMENTS_VIEW)
- `GET /payments/summary` (summary, line 52) @RequirePermission(Permission.PAYMENTS_VIEW)
- `GET /payments/:id` (get, line 61) @RequirePermission(Permission.PAYMENTS_VIEW)
- `PATCH /payments/:id/collector` (reassignCollector, line 71) @RequirePermission(Permission.PAYMENTS_CREATE)
- `POST /payments` (create, line 81) @RequirePermission(Permission.PAYMENTS_CREATE) @Idempotent()
- `POST /payments/:id/cancel` (cancel, line 91) @RequirePermission(Permission.PAYMENTS_CREATE) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /payments/:id/bounce` (bounce, line 103) @RequirePermission(Permission.PAYMENTS_BOUNCE) @Idempotent() @HttpCode(HttpStatus.OK)
- `GET /clients/:id/unpaid-documents` (unpaid, line 120) @RequirePermission(Permission.CLIENTS_VIEW)

## apps/api/src/payroll/payroll.controllers.ts

- `GET /payroll-settings` (get, line 89) 
- `PUT /payroll-settings` (update, line 94) @RequirePermission(Permission.PAYROLL_MANAGE)
- `GET /payroll-rates` (list, line 110) 
- `POST /payroll-rates` (create, line 115) @Idempotent() @RequirePermission(Permission.PAYROLL_RATES_MANAGE)
- `POST /payroll-rates/:id/accept` (accept, line 125) @HttpCode(HttpStatus.OK) @RequirePermission(Permission.PAYROLL_RATES_MANAGE)
- `POST /payroll-rates/:id/keep-own` (keepOwn, line 136) @HttpCode(HttpStatus.OK) @RequirePermission(Permission.PAYROLL_RATES_MANAGE)
- `GET /pay-item-types` (list, line 154) 
- `POST /pay-item-types` (create, line 159) @RequirePermission(Permission.PAYROLL_MANAGE)
- `PUT /pay-item-types/:id` (update, line 167) @RequirePermission(Permission.PAYROLL_MANAGE)
- `DELETE /pay-item-types/:id` (archive, line 176) @RequirePermission(Permission.PAYROLL_MANAGE) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /employees/:id/pay-items` (list, line 190) 
- `POST /employees/:id/pay-items` (append, line 198) @RequirePermission(Permission.PAYROLL_MANAGE) @Idempotent()
- `GET /employees/:id/payslips` (list, line 216) 
- `GET /payroll-runs/das.xlsx` (das, line 234) 
- `GET /payroll-runs/payslips/:id/pdf` (slipPdf, line 242) 
- `GET /payroll-runs/:id/pdf` (runPdf, line 250) 
- `GET /payroll-runs/:id/livre-de-paie.xlsx` (livre, line 258) 
- `GET /payroll-runs/:id/etat-cnas.xlsx` (cnas, line 263) 
- `GET /payroll-runs/:id/recap-irg.xlsx` (irg, line 268) 
- `GET /payroll-runs` (list, line 281) 
- `GET /payroll-runs/:id` (get, line 289) 
- `POST /payroll-runs` (create, line 297) 
- `POST /payroll-runs/:id/recompute` (recompute, line 305) @HttpCode(HttpStatus.OK)
- `PATCH /payroll-runs/:id` (patch, line 314) 
- `POST /payroll-runs/:id/approve` (approve, line 323) @HttpCode(HttpStatus.OK)
- `POST /payroll-runs/:id/cancel` (cancel, line 333) @HttpCode(HttpStatus.OK)
- `POST /payroll-runs/:id/payments` (pay, line 343) @Idempotent()
- `GET /me/payslips` (list, line 360) 
- `GET /me/payslips/:id/pdf` (pdf, line 365) 

## apps/api/src/printing/printing.controller.ts

- `GET /documents/:type/:id/pdf` (document, line 52) 
- `GET /clients/:id/statement/pdf` (statement, line 70) @RequirePermission(Permission.CLIENTS_VIEW)
- `GET /clients/:id/packaging/pdf` (packagingStatement, line 82) 
- `GET /payments/:id/receipt.pdf` (receipt, line 99) @RequirePermission(Permission.PAYMENTS_VIEW)
- `GET /suppliers/:id/statement/pdf` (statement, line 119) @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
- `POST /share-links` (create, line 136) 
- `DELETE /share-links/:id` (revoke, line 144) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /s/:token` (open, line 162) @Public()

## apps/api/src/promotions/promotions.controllers.ts

- `GET /promotions` (list, line 42) @Roles(...SELLERS, Role.LIVREUR)
- `GET /promotions/:id` (get, line 50) @Roles(...SELLERS, Role.LIVREUR)
- `POST /promotions` (create, line 58) @Roles(...MANAGERS)
- `PUT /promotions/:id` (update, line 67) @Roles(...MANAGERS)
- `DELETE /promotions/:id` (archive, line 76) @Roles(...MANAGERS) @HttpCode(HttpStatus.NO_CONTENT)
- `POST /pricing/preview` (preview, line 94) @Roles(...SELLERS, Role.LIVREUR) @HttpCode(HttpStatus.OK)

## apps/api/src/purchases/purchases.controllers.ts

- `GET /suppliers` (list, line 66) @RequirePermission(Permission.SUPPLIERS_VIEW)
- `GET /suppliers/balances` (balances, line 75) @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
- `GET /suppliers/:id/ledger` (ledger, line 81) @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
- `GET /suppliers/:id/statement` (statement, line 90) @RequirePermission(Permission.SUPPLIERS_ACCOUNT)
- `GET /suppliers/:id` (get, line 99) @RequirePermission(Permission.SUPPLIERS_VIEW)
- `POST /suppliers` (create, line 105) @RequirePermission(Permission.SUPPLIERS_CREATE)
- `PATCH /suppliers/:id` (update, line 111) @RequirePermission(Permission.SUPPLIERS_EDIT)
- `DELETE /suppliers/:id` (archive, line 120) @RequirePermission(Permission.SUPPLIERS_EDIT) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /purchases` (list, line 135) @RequirePermission(Permission.PURCHASES_VIEW)
- `GET /purchases/:id` (get, line 144) @RequirePermission(Permission.PURCHASES_VIEW)
- `POST /purchases` (create, line 153) @RequirePermission(Permission.PURCHASES_CREATE) @Idempotent()
- `PUT /purchases/:id` (update, line 163) @RequirePermission(Permission.PURCHASES_CREATE)
- `POST /purchases/:id/validate` (validate, line 173) @RequirePermission(Permission.PURCHASES_VALIDATE) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /purchases/:id/cancel` (cancel, line 185) @RequirePermission(Permission.PURCHASES_CANCEL) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /purchases/:id/returns` (createReturn, line 196) @RequirePermission(Permission.PURCHASES_CANCEL) @Idempotent()
- `GET /supplier-payments` (list, line 214) 
- `GET /supplier-payments/:id` (get, line 221) 
- `POST /supplier-payments` (create, line 226) @RequirePermission(Permission.SUPPLIERS_PAY) @Idempotent()
- `POST /supplier-payments/:id/cancel` (cancel, line 236) @RequirePermission(Permission.SUPPLIERS_PAY) @Idempotent() @HttpCode(HttpStatus.OK)

## apps/api/src/reports/reports.controller.ts

- `GET /dashboard` (get, line 82) 
- `GET /dashboard/todo` (todo, line 91) 
- `GET /dashboard/onboarding` (onboardingStatus, line 97) @Roles(Role.OWNER, Role.MANAGER)
- `POST /dashboard/onboarding/dismiss` (dismissOnboarding, line 103) @HttpCode(HttpStatus.NO_CONTENT) @Roles(Role.OWNER)
- `GET /reports/overview` (overviewReport, line 126) @RequireFeature(Feature.MULTI_UNIT) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/overview/export.xlsx` (overviewExport, line 136) @RequireFeature(Feature.MULTI_UNIT) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/aging` (clientAging, line 154) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/supplier-aging` (supplierAging, line 162) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/aging/export.xlsx` (clientAgingExport, line 170) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/supplier-aging/export.xlsx` (supplierAgingExport, line 180) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/charges` (chargesReport, line 194) @RequireFeature(Feature.EXPENSES) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/charges/export.xlsx` (chargesExport, line 204) @RequireFeature(Feature.EXPENSES) @RequirePermission(Permission.REPORTS_FINANCE)
- `GET /reports/sell-out` (sellOut, line 222) @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
- `GET /reports/sell-out/export.xlsx` (sellOutExport, line 231) @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
- `GET /reports/:name` (run, line 247) @RequirePermission(Permission.REPORTS_VIEW)
- `GET /reports/:name/export.xlsx` (export, line 257) @RequirePermission(Permission.REPORTS_VIEW)

## apps/api/src/sales-force/sectors.controller.ts

- `GET /sectors` (list, line 33) 
- `POST /sectors` (create, line 38) @Roles(...MANAGERS)
- `PATCH /sectors/:id` (update, line 46) @Roles(...MANAGERS)
- `DELETE /sectors/:id` (archive, line 55) @Roles(...MANAGERS) @HttpCode(HttpStatus.NO_CONTENT)

## apps/api/src/sales/sales.controllers.ts

- `GET /sales` (list, line 55) @RequirePermission(Permission.SALES_VIEW)
- `GET /sales/price-preview` (pricePreview, line 65) @RequirePermission(Permission.SALES_VIEW)
- `GET /sales/:id` (get, line 74) @RequirePermission(Permission.SALES_VIEW)
- `PATCH /sales/:id/seller` (reassignSeller, line 84) @RequirePermission(Permission.SALES_CREATE)
- `POST /sales` (create, line 94) @RequirePermission(Permission.SALES_CREATE)
- `POST /sales/quick` (quick, line 103) @RequirePermission(Permission.SALES_CREATE) @Idempotent()
- `PUT /sales/:id` (update, line 113) @RequirePermission(Permission.SALES_CREATE)
- `POST /sales/:id/validate` (validate, line 123) @RequirePermission(Permission.SALES_CREATE) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /sales/:id/cancel` (cancel, line 135) @RequirePermission(Permission.SALES_CREATE) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /sales/:id/returns` (returns, line 147) @RequirePermission(Permission.SALES_RETURN) @Idempotent()
- `POST /invoices/from-bls` (fromBls, line 163) @RequirePermission(Permission.SALES_CREATE) @Idempotent()

## apps/api/src/stock/stock.controllers.ts

- `GET /stock` (list, line 61) @RequirePermission(Permission.STOCK_VIEW)
- `GET /stock/reconcile` (reconcile, line 76) @Roles(Role.OWNER)
- `GET /stock/:productId` (level, line 82) @RequirePermission(Permission.STOCK_VIEW)
- `GET /stock/:productId/movements` (movements, line 96) @RequirePermission(Permission.STOCK_VIEW)
- `POST /stock/opening` (opening, line 111) @RequirePermission(Permission.STOCK_ADJUST) @Idempotent()
- `POST /stock/adjustments` (adjust, line 122) @Idempotent()
- `GET /inventories` (list, line 136) @RequirePermission(Permission.STOCK_VIEW)
- `GET /inventories/:id` (get, line 142) @RequirePermission(Permission.STOCK_VIEW)
- `POST /inventories` (create, line 152) @RequirePermission(Permission.STOCK_COUNT) @Idempotent()
- `PUT /inventories/:id/lines` (setLines, line 162) @RequirePermission(Permission.STOCK_COUNT)
- `POST /inventories/:id/validate` (validate, line 172) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /inventories/:id/cancel` (cancel, line 182) @RequirePermission(Permission.STOCK_ADJUST) @Idempotent() @HttpCode(HttpStatus.OK)

## apps/api/src/stock/warehouses.controllers.ts

- `GET /warehouses` (list, line 54) 
- `GET /warehouses/:id` (detail, line 60) @RequireFeature(Feature.MULTI_UNIT)
- `POST /warehouses` (create, line 69) @RequirePermission(Permission.SETTINGS_EDIT) @RequireFeature(Feature.WAREHOUSES)
- `PATCH /warehouses/:id` (update, line 79) @RequirePermission(Permission.SETTINGS_EDIT) @RequireFeature(Feature.WAREHOUSES)
- `PUT /warehouses/:id/brands` (setBrands, line 91) @RequirePermission(Permission.SETTINGS_EDIT) @RequireFeature(Feature.MULTI_UNIT)
- `PUT /warehouses/:id/categories` (setCategories, line 103) @RequirePermission(Permission.SETTINGS_EDIT) @RequireFeature(Feature.MULTI_UNIT)
- `DELETE /warehouses/:id` (archive, line 114) @RequirePermission(Permission.SETTINGS_EDIT) @RequireFeature(Feature.WAREHOUSES) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /stock-transfers` (list, line 132) 
- `GET /stock-transfers/:id` (get, line 140) 
- `POST /stock-transfers` (create, line 148) @Idempotent()
- `PUT /stock-transfers/:id` (update, line 157) 
- `POST /stock-transfers/:id/validate` (validate, line 166) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /stock-transfers/:id/cancel` (cancel, line 176) @Idempotent() @HttpCode(HttpStatus.OK)

## apps/api/src/tenants/tenants.controller.ts

- `GET /tenant/settings` (get, line 17) 
- `PATCH /tenant/settings` (update, line 22) @RequirePermission(Permission.SETTINGS_EDIT)

## apps/api/src/tournees/tournees.controllers.ts

- `GET /routes` (list, line 86) 
- `GET /routes/:id` (get, line 94) 
- `POST /routes` (create, line 102) @Roles(...PLANNERS)
- `PATCH /routes/:id` (update, line 111) @Roles(...PLANNERS)
- `PUT /routes/:id/stops` (setStops, line 121) @Roles(...PLANNERS)
- `DELETE /routes/:id` (archive, line 131) @Roles(...PLANNERS) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /me/today` (today, line 148) 
- `GET /visits` (list, line 159) 
- `GET /visits/:id` (get, line 167) 
- `POST /visits` (create, line 175) @Idempotent() @Roles(...SELLERS)
- `GET /orders` (list, line 191) 
- `GET /orders/deliverers` (deliverers, line 200) @Roles(...PLANNERS)
- `GET /orders/:id` (get, line 206) 
- `POST /orders` (create, line 214) @Idempotent() @Roles(...SELLERS)
- `PUT /orders/:id` (update, line 224) @Roles(...SELLERS)
- `POST /orders/:id/confirm` (confirm, line 234) @Idempotent() @Roles(...SELLERS) @HttpCode(HttpStatus.OK)
- `POST /orders/:id/cancel` (cancel, line 245) @Idempotent() @Roles(...SELLERS) @HttpCode(HttpStatus.OK)
- `PATCH /orders/:id/livreur` (assignLivreur, line 257) @Roles(...PLANNERS)
- `POST /orders/:id/deliver` (deliver, line 267) @Idempotent() @Roles(...DELIVERERS) @HttpCode(HttpStatus.OK)
- `GET /seller-sessions` (list, line 286) 
- `GET /seller-sessions/:id` (get, line 294) 
- `POST /seller-sessions` (open, line 302) @Idempotent()
- `POST /seller-sessions/:id/close` (close, line 311) @Idempotent() @HttpCode(HttpStatus.OK)
- `POST /seller-sessions/:id/adjust` (adjust, line 322) @Idempotent()
- `GET /tournees/reports` (report, line 339) 

## apps/api/src/treasury/treasury.controllers.ts

- `GET /cash-accounts` (list, line 58) 
- `POST /cash-accounts` (create, line 66) @RequirePermission(Permission.TREASURY_MANAGE)
- `GET /cash-accounts/:id` (get, line 75) @RequirePermission(Permission.TREASURY_VIEW)
- `PATCH /cash-accounts/:id` (update, line 84) @RequirePermission(Permission.TREASURY_MANAGE)
- `DELETE /cash-accounts/:id` (archive, line 94) @RequirePermission(Permission.TREASURY_MANAGE) @HttpCode(HttpStatus.NO_CONTENT)
- `GET /cash-accounts/:id/movements` (movements, line 101) @RequirePermission(Permission.TREASURY_VIEW)
- `POST /cash-accounts/:id/opening` (opening, line 111) @Idempotent() @RequirePermission(Permission.TREASURY_MANAGE) @HttpCode(HttpStatus.OK)
- `POST /cash-accounts/:id/counts` (count, line 123) @Idempotent() @RequirePermission(Permission.TREASURY_OPERATE)
- `GET /treasury/summary` (summary, line 140) @RequirePermission(Permission.TREASURY_VIEW)
- `GET /treasury/reconcile` (reconcile, line 149) @RequirePermission(Permission.TREASURY_MANAGE)
- `POST /treasury/transfers` (transfer, line 155) @Idempotent() @RequirePermission(Permission.TREASURY_OPERATE)
- `POST /treasury/transfers/:id/cancel` (cancelTransfer, line 165) @Idempotent() @RequirePermission(Permission.TREASURY_OPERATE) @HttpCode(HttpStatus.OK)

## apps/api/src/users/users.controller.ts

- `GET /users` (list, line 52) @RequirePermission(Permission.USERS_VIEW)
- `POST /users/invite` (invite, line 58) @RequirePermission(Permission.USERS_MANAGE)
- `GET /users/sellers` (sellers, line 68) @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
- `GET /users/team` (team, line 77) @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR) @RequireFeature(Feature.SALES_FORCE)
- `GET /users/me/dashboard-layout` (dashboardLayout, line 85) 
- `PATCH /users/me/dashboard-layout` (saveDashboardLayout, line 90) 
- `GET /users/:id` (get, line 98) @RequirePermission(Permission.USERS_VIEW)
- `PUT /users/:id` (update, line 104) @RequirePermission(Permission.USERS_MANAGE)
- `PUT /users/:id/permissions` (permissions, line 114) @RequirePermission(Permission.USERS_MANAGE)
- `GET /users/:id/access` (getAccess, line 125) @RequirePermission(Permission.USERS_VIEW) @RequireFeature(Feature.MULTI_UNIT)
- `PUT /users/:id/access` (setAccess, line 133) @RequirePermission(Permission.WAREHOUSE_ACCESS_MANAGE) @RequireFeature(Feature.MULTI_UNIT)
- `POST /users/:id/deactivate` (deactivate, line 144) @RequirePermission(Permission.USERS_MANAGE) @HttpCode(HttpStatus.OK)
- `POST /users/:id/reactivate` (reactivate, line 154) @RequirePermission(Permission.USERS_MANAGE) @HttpCode(HttpStatus.OK)
- `POST /users/:id/reset-password` (resetPassword, line 164) @RequirePermission(Permission.USERS_MANAGE) @HttpCode(HttpStatus.OK)
