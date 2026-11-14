# auth

Total 32 · PASS 21 · FAIL 6 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| B3. Access tokens | an expired access token is refused (TOKEN_EXPIRED) | PASS |  |  |
| B3. Access tokens | alg "none" and a token signed with another secret are refused | PASS |  |  |
| B3. Access tokens | a valid signature is not enough: the role and the company come from the session row | PASS |  |  |
| B3. Access tokens | the API refuses to start in production with the JWT secret published in .env.example | FAIL |  | the API is running with NODE_ENV=production and JWT_ACCESS_SECRET equal to the value of .env.example (config/app-config.ts only checks its length) |
| B3. Sessions: logout, revocation, password change | logout kills the access token and the refresh token of that session | PASS |  |  |
| B3. Sessions: logout, revocation, password change | a session revoked by the owner dies at once; a seller cannot revoke another user | PASS |  |  |
| B3. Sessions: logout, revocation, password change | a password change closes every other session of the user | PASS |  |  |
| B3. Sessions: logout, revocation, password change | a role change and a deactivation apply to a token already issued | PASS |  |  |
| B3. Invitation and reset links | an invitation link works once | PASS |  |  |
| B3. Invitation and reset links | twenty simultaneous uses of one link: one wins | PASS |  |  |
| B3. Invitation and reset links | an expired link, a replaced link and the link of a deactivated user are refused, with the same answer as an unknown one | PASS |  |  |
| B3. Invitation and reset links | only the hash of a link is stored, and the link is 32 random bytes | PASS |  |  |
| B3. Invitation and reset links | a reset link logs the old password and the old sessions out | PASS |  |  |
| B3. User enumeration and account lock-out | a wrong password and an unknown account get the same answer | PASS |  |  |
| B3. User enumeration and account lock-out | login timing: known 46 ms, unknown 39 ms | INFO |  |  |
| B3. User enumeration and account lock-out | response time does not tell a known account from an unknown one (median of 12 each) | PASS |  |  |
| B3. User enumeration and account lock-out | the lock-out does not tell whether an account exists | FAIL |  | existing account: INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,ACCOUNT_LOCKED,ACCOUNT_LOCKED \| unknown: INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS,INVALID_CREDENTIALS |
| B3. User enumeration and account lock-out | an anonymous visitor cannot lock a user out of his account (the right password still works) | FAIL |  | 5 wrong passwords from 5 addresses, then the right one: HTTP 423 ACCOUNT_LOCKED, lockedUntil 2026-11-14 19:08:08.469+00 |
| B3. User enumeration and account lock-out | registration does not tell whether an email is already used | FAIL |  | HTTP 409 {"code":"EMAIL_ALREADY_USED","message":"This email is already used","requestId":"c09c1413-eb96-4ab6-97d1-46430505e3cf"} |
| B3. Cookies, CSRF, CORS, headers | Set-Cookie: erp_rt=…; Max-Age=2592000; Path=/auth; Expires=Mon, 14 Dec 2026 18:53:08 GMT; HttpOnly; SameSite=Lax (Secure follows COOKIE_SECURE, false in this local stack and by default) | INFO |  |  |
| B3. Cookies, CSRF, CORS, headers | the refresh cookie is HttpOnly, SameSite=Lax, limited to /auth, and the web answer carries no refresh token | PASS |  |  |
| B3. Cookies, CSRF, CORS, headers | the cookie alone opens no business route (only /auth/refresh reads it) | PASS |  |  |
| B3. Cookies, CSRF, CORS, headers | cross-site form POST /auth/refresh with the cookie: HTTP 200, Access-Control-Allow-Origin: none | INFO |  |  |
| B3. Cookies, CSRF, CORS, headers | a cross-site form cannot use the refresh cookie (Origin is checked, or the body must be JSON) | FAIL |  | the session was rotated by a cross-site form (HTTP 200); only SameSite=Lax stands between a hostile page and the cookie |
| B3. Cookies, CSRF, CORS, headers | CORS: only WEB_ORIGIN is allowed, with credentials | PASS |  |  |
| B3. Cookies, CSRF, CORS, headers | CSP default-src 'self';base-uri 'self';font-, HSTS max-age=31536000; includeSubDomains, nosniff nosniff, frame SAMEORIGIN, referrer no-referrer, x-powered-by null | INFO |  |  |
| B3. Cookies, CSRF, CORS, headers | the API sends the helmet headers and no version banner | PASS |  |  |
| B3. Super-admin: TOTP and impersonation | the password alone does not open the super-admin area | PASS |  |  |
| B3. Super-admin: TOTP and impersonation | a TOTP code cannot be used twice | FAIL |  | the same 6 digits opened a second session (RFC 6238 §5.2: a code must be accepted once) |
| B3. Super-admin: TOTP and impersonation | a tenant token does not open /admin, and an admin token opens no tenant route | PASS |  |  |
| B3. Super-admin: TOTP and impersonation | impersonation: read 200, write 403 IMPERSONATION_READ_ONLY, chat 403, logout 403, requests journaled 4, start journaled 1, after the admin logged out 401 SESSION_REVOKED | INFO |  |  |
| B3. Super-admin: TOTP and impersonation | impersonation is read-only, written to the platform journal, and ends with the admin session | PASS |  |  |