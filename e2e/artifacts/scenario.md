# scenario

Total 17 · PASS 17 · FAIL 0 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| 1. Sale on credit | sale is validated and numbered | PASS |  |  |
| 1. Sale on credit | state after the sale is the expected one | PASS |  |  |
| 1. Sale on credit | the sale DTO totals match the ledger | PASS |  |  |
| 2. Partial payment (versement) | the payment lowers the client balance and allocates the oldest document | PASS |  |  |
| 2. Partial payment (versement) | the payment is audited | PASS |  |  |
| 3. Return of one unit | the avoir restocks the goods and lowers the balance | PASS |  |  |
| 3. Return of one unit | the avoir has its own number and ledger entry | PASS |  |  |
| 4. Cancellation of the sale | the sale is cancelled | PASS |  |  |
| 4. Cancellation of the sale | the balance is back to zero and the goods are back | PASS |  |  |
| 4. Cancellation of the sale | the cancellation is audited | PASS |  |  |
| 5. Counter sale (no client) | a counter sale moves the stock but no client account | PASS |  |  |
| 6. Facture grouping BLs | the facture is created and numbered | PASS |  |  |
| 6. Facture grouping BLs | the grouped facture does not charge the client twice | PASS |  |  |
| 7. Document numbering | the numbers of a tenant are sequential per type and year | PASS |  |  |
| 8. Audit trail | every business write left an audit row | PASS |  |  |
| 8. Audit trail | the audit rows keep who, when and which device | PASS |  |  |
| 8. Audit trail | scenario completed | PASS | the whole sale/payment/return/cancel chain holds | tenant 0b46202d-e1e4-4141-ac8e-a7ae3adcfa69 |