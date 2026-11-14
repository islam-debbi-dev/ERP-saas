# scopes

Total 34 · PASS 24 · FAIL 5 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 finds nothing of seller 2 in any GET route (his client, sale, versement, order) | FAIL |  | 1 answer(s): /stock/:id/movements → sale of seller 2+sale number |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | the supervisor of seller 1 finds nothing of seller 2 (not in his team) | FAIL |  | 1 answer(s): /stock/:id/movements → sale of seller 2+sale number |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | the supervisor does see the sale of his own seller | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot sell to the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot collect a versement from the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot take an order from the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot record a visit to the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot return the sale of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot share the relevé of the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot edit the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot move the pin of the client of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | seller 1 cannot cancel the order of seller 2 | PASS |  |  |
| B2. Scope: a seller sees only his clients, sales and versements (ASSIGNED_ONLY) | a seller's report and dashboard figures are his own, whatever he asks for | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | allowed by domain.md and not counted: /clients/:id (client account across dépôts) ; /clients/:id/statement (client account across dépôts) ; /stock-transfers (transfer to his own dépôt) ; /stock-transfers/:id (transfer to his own dépôt) | INFO |  |  |
| B2. Scope: a user limited to one dépôt never sees another | a MANAGER working only in the annexe finds nothing of the dépôt principal in any GET route | FAIL |  | 2 answer(s): /audit-logs → dépôt principal (id)+sale of the dépôt principal+its number+caisse principale (id)+dépense of the dépôt principal+inventory of the dépôt principal+employee of the dépôt principal ; /clients/:id/unpaid-documents → sale of the dépôt principal+its number |
| B2. Scope: a user limited to one dépôt never sees another | he does see the sale of his own dépôt | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot sell from the dépôt principal | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot adjust the stock of the dépôt principal | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot take stock out of the dépôt principal by transfer | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot cancel the sale of the dépôt principal | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot cancel the dépense of the dépôt principal | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot pay a dépense from the caisse principale | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot collect a versement into the caisse principale | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot count the caisse principale | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | the manager of the annexe cannot give himself access to the dépôt principal | PASS |  |  |
| B2. Scope: a user limited to one dépôt never sees another | a user with "Voir les statistiques" only reads no single document and nothing of the other dépôt | FAIL |  | 3 answer(s): /audit-logs → dépôt principal (id)+sale of the dépôt principal+its number+caisse principale (id)+dépense of the dépôt principal+inventory of the dépôt principal+employee of the dépôt principal+a document of the annexe+its number (annexe) ; /clients/:id/statement → its number (annexe) ; /clients/:id/unpaid-documents → sale of the dépôt principal+its number+a document of the annexe+its number (annexe) |
| B2. Scope: a user limited to one dépôt never sees another | "Voir les statistiques" gives no client ledger and no user list | FAIL |  | statement 200, users 200, sale from the annexe 404 |
| B2. Scope: without SALARY_VIEW pay does not exist | allowed by domain.md and not counted: /reports/overview (salary total in charges and cash) ; /treasury/summary (salary total in charges and cash) | INFO |  |  |
| B2. Scope: without SALARY_VIEW pay does not exist | 8 pay rows of the company searched in 828 GET paths | INFO |  |  |
| B2. Scope: without SALARY_VIEW pay does not exist | a MANAGER without SALARY_VIEW finds no pay row and no pay figure in any GET route | PASS |  |  |
| B2. Scope: Excel exports | figures searched in the exports: margin 3600.00, stock value 197600.00 | INFO |  |  |
| B2. Scope: Excel exports | exports read: /attendance/month/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /payroll-runs/das.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 403 ; /reports/overview/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 — labels: Marge brute, Résultat net, Valeur du stock ; /reports/aging/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/supplier-aging/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/charges/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/sell-out/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/sales/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/margin/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 403 ; /reports/stock-movements/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/payments/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 ; /reports/purchases/export.xlsx: owner 200, manager without VIEW_COST_AND_MARGIN 200 | INFO |  |  |
| B2. Scope: Excel exports | no export gives the margin or the stock value to a user without VIEW_COST_AND_MARGIN | PASS |  |  |
| B2. Scope: Excel exports | a user without EXPORT_DATA gets no export at all | PASS |  |  |