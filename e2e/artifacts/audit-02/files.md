# files

Total 23 · PASS 14 · FAIL 3 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| B5. Excel and CSV import | the template of an import opens and a valid file is previewed | PASS |  |  |
| B5. Excel and CSV import | a file over 10 MB is refused with 413, not read | PASS |  |  |
| B5. Excel and CSV import | a file that is not a spreadsheet is refused cleanly, whatever its name and type say | PASS |  |  |
| B5. Excel and CSV import | hostile file name: HTTP 400 VALIDATION_FAILED; stored as "clients.xlsx" (the file itself is a column of import_jobs: nothing is written to disk) | INFO |  |  |
| B5. Excel and CSV import | a hostile file name is kept as a name only (no path, no markup executed, no 500) | PASS |  |  |
| B5. Excel and CSV import | more than 10 000 rows are refused | PASS |  |  |
| B5. Excel and CSV import | a formula in a cell of an imported file is read as its saved value, never evaluated | PASS |  |  |
| B5. Excel and CSV import | a SELLER cannot import (matrix) and cannot read an import job of the company | PASS |  |  |
| B5. Public share links | a link is 32 random bytes, expires in 7 days, and only its hash is stored | PASS |  |  |
| B5. Public share links | GET /s/<token>: HTTP 200, application/pdf, 143441 bytes, Cache-Control: none, X-Robots-Tag: none | INFO |  |  |
| B5. Public share links | the link opens the PDF without login, and the answer may not be cached or indexed | FAIL |  | Cache-Control: none — a CDN or a shared proxy may keep a client's facture |
| B5. Public share links | each opening is counted and written to the journal | PASS |  |  |
| B5. Public share links | an unknown, a revoked and an expired link get the same answer, and a revoked link stays dead | PASS |  |  |
| B5. Public share links | a link cannot be made for a BL, a draft, or with a period over a year | PASS |  |  |
| B5. Public share links | the relevé of a link shows that client only | PASS |  |  |
| B5. Public share links | web /s/<token>: HTTP 307 → http://localhost:3003/s/<token>, Referrer-Policy no-referrer, Cache-Control no-store | INFO |  |  |
| B5. Public share links | the web address /s/<token> forwards without leaking the token (no referrer, no cache) | PASS |  |  |
| B5. Public share links | a seller cannot revoke the link another user made | FAIL |  | DELETE by a seller: 204; the link then answers 410 |
| B5. Public share links | 40 anonymous openings: 40 PDFs rendered, 0 throttled, 1.4 s; journal rows SHARE_LINK_OPENED: 43 (no limit of its own on this public route; part D) | INFO |  |  |
| B5. Excel import: zip bomb | a tenant created by POST /auth/register a second ago uploads an import file: HTTP 200 | INFO |  |  |
| B5. Excel import: zip bomb | a company that has just signed up may import (no plan gate before the bomb) | PASS |  |  |
| B5. Excel import: zip bomb | zip bomb: file 1.0 MB zipped, ~305 MB inflated; answer HTTP 0  after 14.4 s; API memory 265 MB → peak 1831 MB; /health asked during the read answered 0 after 7110 ms; API process DEAD (FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory) | INFO |  |  |
| B5. Excel import: zip bomb | a zip bomb (a small .xlsx that inflates to hundreds of MB) does not take the API down | FAIL |  | file 1.0 MB zipped, ~305 MB inflated; answer HTTP 0  after 14.4 s; API memory 265 MB → peak 1831 MB; /health asked during the read answered 0 after 7110 ms; API process DEAD (FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory) |