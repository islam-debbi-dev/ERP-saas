# attacks

Total 48 · PASS 44 · FAIL 2 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| A. Tenant isolation | A cannot read B's product | PASS |  |  |
| A. Tenant isolation | A cannot read B's client | PASS |  |  |
| A. Tenant isolation | A cannot read B's sale | PASS |  |  |
| A. Tenant isolation | A cannot see B's documents in the lists | PASS |  |  |
| A. Tenant isolation | a tenantId in the body is ignored (the JWT decides) | PASS |  |  |
| A. Tenant isolation | the stock of a tenant is not shared | PASS |  |  |
| B. Idempotency | a POST that creates money needs an Idempotency-Key | PASS |  |  |
| B. Idempotency | the same key and the same body replay the same answer | PASS |  |  |
| B. Idempotency | the same key with another body is refused | PASS |  |  |
| B. Idempotency | a failed request does not consume a document number | PASS |  |  |
| C. Permissions (phase 11) | a SELLER cannot cancel a validated sale | PASS |  |  |
| C. Permissions (phase 11) | a SELLER cannot adjust the stock | PASS |  |  |
| C. Permissions (phase 11) | a MANAGER cannot invite a user (OWNER only) | PASS |  |  |
| C. Permissions (phase 11) | a STOREKEEPER can count but not validate an inventory | PASS |  |  |
| C. Permissions (phase 11) | a grant is visible at once, a revoke too | PASS |  |  |
| C. Permissions (phase 11) | a deactivated user is locked out and his session dies | PASS |  |  |
| C. Permissions (phase 11) | a temporary password blocks every route but the password change | PASS |  |  |
| C. Permissions (phase 11) | a SELLER cannot change the price of a line | PASS |  |  |
| C. Permissions (phase 11) | a SELLER does not see the costs and the margins | PASS |  |  |
| D. Money precision | an amount with 3 decimals is refused | PASS |  |  |
| D. Money precision | an amount over Decimal(14,2) is refused with a clean error | FAIL | HTTP 400 VALIDATION_FAILED (the amount does not fit in Decimal(14,2)) | HTTP 500 INTERNAL_ERROR {"code":"INTERNAL_ERROR","message":"Internal server error"} |
| D. Money precision | the totals are exact on a non-round price | PASS |  |  |
| D. Money precision | a quantity with more than 3 decimals is refused | PASS |  |  |
| E. Concurrency | three concurrent payments do not lose an update | PASS |  |  |
| E. Concurrency | two concurrent sales of the last unit: BLOCK mode sells one only | PASS |  |  |
| E. Concurrency | two concurrent sales of the last unit: WARN mode announces the negative stock | PASS |  |  |
| F. Authentication | five wrong passwords lock the account | PASS |  |  |
| F. Authentication | a forged token is refused | PASS |  |  |
| F. Authentication | no token at all is refused | PASS |  |  |
| F. Authentication | a refresh token reused after the grace window closes the session | PASS |  |  |
| F. Authentication | ten logins from one IP lock out a valid user of another account | PASS |  |  |
| F. Authentication | the login rate limit is bypassed with a forged X-Forwarded-For | PASS |  |  |
| F. Authentication | the forged IP is what the audit trail records | PASS |  |  |
| G. State machine and optimistic locking | a sale cannot be validated twice | PASS |  |  |
| G. State machine and optimistic locking | a stale version is refused | PASS |  |  |
| G. State machine and optimistic locking | more than sold cannot be returned | PASS |  |  |
| G. State machine and optimistic locking | a payment made with a sale cannot be cancelled alone | PASS |  |  |
| G. State machine and optimistic locking | a cash payment cannot bounce | PASS |  |  |
| G. State machine and optimistic locking | a bounced cheque gives the money back to the account | PASS |  |  |
| G. State machine and optimistic locking | more allocated than paid is refused | PASS |  |  |
| H. Injection and mass assignment | a hostile id is refused, not a 500 | PASS |  |  |
| H. Injection and mass assignment | a hostile search term is harmless | PASS |  |  |
| H. Injection and mass assignment | the client balance cannot be written directly | PASS |  |  |
| H. Injection and mass assignment | info: the API stores the payload as data, the web must escape it | INFO | the API stores the text; React escapes it on render | designation=<script>alert(1)</script> |
| H. Injection and mass assignment | a script tag in a designation is stored as data | PASS |  |  |
| I. Audit trail and timestamps | the rows of one operation share the same createdAt | FAIL |  | 5 rows of one transaction carry 5 different createdAt values: 2026-10-21 20:29:04.443+00, 2026-10-21 20:29:04.481+00, 2026-10-21 20:29:04.485+00, 2026-10-21 20:29:04.489+00, 2026-10-21 20:29:04.492+00 |
| I. Audit trail and timestamps | info: the createdAt of the audit rows of one transaction | INFO | one timestamp for the whole transaction (the schema says so) | 2 rows, 2 timestamps, xmin=6247/6249 |
| I. Audit trail and timestamps | the audit rows of one operation keep the transaction order | PASS |  |  |