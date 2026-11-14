# secrets

Total 12 · PASS 6 · FAIL 1 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| general | requests sent: register 201, admin login 200, cheque 201, cheque made to fail 500, invite made to fail 400, salary 201, salary made to fail 400, avance made to fail 400, share link opened 200 | INFO |  |  |
| B7. Logs | API log: 500 lines at level debug; 1 error lines | INFO |  |  |
| B7. Logs | no password, token, cookie, TOTP secret, cheque or salary is written to the API log | FAIL |  | in the log: invitation link token, share link token |
| B7. Logs | the Authorization and Cookie headers are redacted in the log | PASS |  |  |
| B7. Logs | a 500 logs its error without the request body | PASS |  |  |
| B7. Sentry | 3 envelope(s) received by the sink, 1 with an exception | INFO |  |  |
| B7. Sentry | the 500s reached Sentry (or the check below proves nothing) | PASS |  |  |
| B7. Sentry | no password, token, cookie, cheque or salary is sent to Sentry | PASS |  |  |
| B7. Sentry | request bodies in Sentry: in the error event no; in 0 trace span(s) (tracesSampleRate 0.1, so one request in ten) | INFO |  |  |
| B7. Sentry | Sentry event: request body absent, Authorization absent, cookies absent, user ip "ip_address":"::1" | INFO |  |  |
| B7. Sentry | a Sentry event carries no request body, no cookie and no Authorization header | PASS |  |  |
| B7. Database | passwords are argon2 hashes; refresh tokens, invitation links and share links are stored as hashes only | PASS |  |  |