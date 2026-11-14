# input

Total 15 · PASS 8 · FAIL 0 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| B4. Mass assignment | 76 create routes replayed with id, tenantId, createdAt, updatedAt, createdBy, number, status, balance, role, isFree, edition, deletedAt, totalTtc, avgCost, permissionGrants: statuses {"200":7,"201":31,"400":3,"404":1,"409":34}; PATCH /tenant/settings with plan fields: 400 | INFO |  |  |
| B4. Mass assignment | no row took the id, the date, the number or the author sent by the client | PASS |  |  |
| B4. Mass assignment | a body cannot change the plan of the company or grant itself a permission | PASS |  |  |
| B4. Query strings and raw bodies | malformed 400, 2 MB 413, 20 000 levels 400, __proto__ 201, XML 400 | INFO |  |  |
| B4. Query strings and raw bodies | a malformed, a huge and a deeply nested body are refused cleanly | PASS |  |  |
| B4. Verdict of the sweeps | 1658 hostile requests: 52 amount or quantity fields × 15 values (780), 51 text fields × 9 values, 91 list routes | INFO |  |  |
| B4. Verdict of the sweeps | no hostile value answers 5xx | PASS |  |  |
| B4. Verdict of the sweeps | no error shows a stack trace, a file path or an SQL message | PASS |  |  |
| B4. Verdict of the sweeps | no amount is accepted as NaN, Infinity, an exponent, a JSON number or with too many decimals | PASS |  |  |
| B4. Verdict of the sweeps | negative values accepted (read one by one in the report): POST /stock/adjustments lines[].qty = negative → 201  ; POST /clients/:id/adjustments amount = negative → 201  ; PATCH /suppliers/:id phone = negative → 200  | INFO |  |  |
| B4. Verdict of the sweeps | text accepted with a NUL byte or a lone surrogate: 3 field(s) | INFO |  |  |
| B4. Stored markup, where it is shown | BL PDF 142461 bytes, relevé PDF 200; requests received by the canary server: 0; text printed: the tag as text | INFO |  |  |
| B4. Stored markup, where it is shown | markup in a product, a client and a note is printed as text: the PDF loads nothing and reads no file | PASS |  |  |
| B4. Stored markup, where it is shown | exports that carry the hostile client name: 2; stored as formula: 0 | INFO |  |  |
| B4. Stored markup, where it is shown | a client name starting with = + - @ is not a formula in the Excel exports | PASS |  |  |