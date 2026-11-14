# concurrency

Total 14 · PASS 14 · FAIL 0 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| C1. Two sellers, the last unit (20 at once) | BLOCK: exactly one sale wins, the 19 others are refused cleanly | PASS |  |  |
| C1. Two sellers, the last unit (20 at once) | BLOCK: the refused sales burned no document number | PASS |  |  |
| C1. Two sellers, the last unit (20 at once) | WARN: the 20 sales pass and the stock is exactly -20, equal to its ledger | PASS |  |  |
| C1. Two sellers, the last unit (20 at once) | sales locking two products in opposite orders never deadlock into a 500 | PASS |  |  |
| C1. Two sellers, the last unit (20 at once) | a draft validated 20 times at once is validated once | PASS |  |  |
| C1. Two sellers, the last unit (20 at once) | a sale cancelled 20 times at once is reversed once | PASS |  |  |
| C2. Versements on one client (20 at once) | no versement is lost: 11 900 - 20 x 100 = 9 900, ledger equal, numbers 1..20 | PASS |  |  |
| C4. The same Idempotency-Key sent 20 times | one key creates one versement, whatever the number of copies in flight | PASS |  |  |
| C4. The same Idempotency-Key sent 20 times | every copy answers the original (2xx, same id) or "in progress" (409), nothing else | PASS |  |  |
| C4. The same Idempotency-Key sent 20 times | the key replayed afterwards still answers the original | PASS |  |  |
| C3. Transfers out of one cash account (20 at once) | exactly 10 transfers pass, the caisse ends at zero and never below | PASS |  |  |
| C3. Transfers out of one cash account (20 at once) | transfers in both directions never deadlock and the money stays 1 000 DA | PASS |  |  |
| C5. The same payroll run approved 20 times, then paid 20 times | one approval wins: one number, the salary posted once | PASS |  |  |
| C5. The same payroll run approved 20 times, then paid 20 times | a run paid 20 times at once is paid once | PASS |  |  |