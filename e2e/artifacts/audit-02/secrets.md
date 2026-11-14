# secrets

Total 12 · PASS 4 · FAIL 3 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| general | requests sent: register 201, admin login 200, cheque 201, cheque made to fail 500, invite made to fail 201, salary 201, salary made to fail 400, avance made to fail 201, share link opened 200 | INFO |  |  |
| B7. Logs | API log: 500 lines at level debug; 1 error lines | INFO |  |  |
| B7. Logs | no password, token, cookie, TOTP secret, cheque or salary is written to the API log | FAIL |  | in the log: invitation link token, share link token |
| B7. Logs | the Authorization and Cookie headers are redacted in the log | PASS |  |  |
| B7. Logs | a 500 logs its error without the request body | PASS |  |  |
| B7. Sentry | 4 envelope(s) received by the sink, 1 with an exception | INFO |  |  |
| B7. Sentry | the 500s reached Sentry (or the check below proves nothing) | PASS |  |  |
| B7. Sentry | no password, token, cookie, cheque or salary is sent to Sentry | FAIL |  | sent to Sentry: owner password, refresh cookie, cheque number, cheque bank, salary amount |
| B7. Sentry | request bodies in Sentry: in the error event yes; in 2 trace span(s) (tracesSampleRate 0.1, so one request in ten) | INFO |  |  |
| B7. Sentry | Sentry event: request body present, Authorization absent, cookies absent, user ip "ip_address":"::1" | INFO |  |  |
| B7. Sentry | a Sentry event carries no request body, no cookie and no Authorization header | FAIL |  | body true, authorization false, cookies false |
| B7. Database | passwords are argon2 hashes; refresh tokens, invitation links and share links are stored as hashes only | PASS |  |  |