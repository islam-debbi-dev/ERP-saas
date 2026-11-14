# scenario

Total 89 · PASS 88 · FAIL 1 · BLOCKED 0

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
| 9. Import: landed costs, close, sale, late cost | the dossier is numbered DI-YYYY-000001 and open | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | a BR of an open dossier posts the supplier account and moves no stock | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | a cost with a supplier is a debt; a cost paid now leaves the caisse | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | closing puts the goods in stock at the coût de revient | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | closing twice with the same key replays and moves nothing | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | the sale leaves at the landed cost and its cash reaches the caisse | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | a late cost moves the CUMP of what is on hand only | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | the past sale keeps its cost; the share of sold units is the écart (2 400 DA) | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | a règlement in USD lowers both balances and leaves the bank in DZD | PASS |  |  |
| 9. Import: landed costs, close, sale, late cost | the BR got its number at validation and the dossier keeps its own | PASS |  |  |
| 10. Dépôts, camion, tournée | a transfer and a chargement move the goods between dépôts, not the CUMP | PASS |  |  |
| 10. Dépôts, camion, tournée | a seller's sale with no dépôt chosen leaves from his truck (domain.md, phase 15) | PASS | truck 20, dépôt principal 66 |  |
| 10. Dépôts, camion, tournée | the sale itself is right: total, credit, company stock | PASS |  |  |
| 10. Dépôts, camion, tournée | stock is judged per dépôt: more than the truck holds is refused in BLOCK mode | PASS |  |  |
| 10. Dépôts, camion, tournée | a confirmed order is numbered and touches neither stock nor the account | PASS |  |  |
| 10. Dépôts, camion, tournée | delivering 7 of 10 creates one BL for 7, from the dépôt of the order | PASS |  |  |
| 10. Dépôts, camion, tournée | the same delivery sent again replays and delivers nothing more | PASS |  |  |
| 10. Dépôts, camion, tournée | a déchargement brings the truck back to zero | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | the session expects the seller's cash (2 000 at the sale + 500) and stores the écart | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | the client account holds the sale, the cash and the cheque | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | cash went to the caisse and the cheque to the bank | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | 30 bouteilles leave 2 casiers with the client, 1 comes back at the sale | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | a return of empties brings the count to zero | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | cancelling the sale reverses exactly what it left (2 given - 1 returned) | PASS |  |  |
| 11. Clôture de tournée, emballages consignés | document numbers of the company have no gap | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | a BR paid in part at reception leaves the rest as a debt and takes the cash | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | a cheque to the supplier lowers the debt and leaves the bank | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | the cheque is listed among the cheques due this week | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | cancelling the règlement brings the debt and the money back, nothing deleted | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | the supplier aging sums to the balance, all in 0-30 days | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | the client aging puts each debt in its bucket and a versement on the oldest | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | a client cheque lowers his balance and goes to the bank | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | a bounced cheque gives the debt back, plus the bank fees, and leaves the bank | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | the relevé of the client ends on his balance | PASS |  |  |
| 12. Règlements fournisseur, chèques, balances âgées | numbers: BR, RGF, VER, BL have no gap | PASS |  |  |
| 13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble | the charges of 2026-11-01..2026-11-14 are the rent by day + the dépenses, the rent payment apart | PASS |  |  |
| 13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble | a whole month of a monthly lease costs exactly its amount | PASS |  |  |
| 13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble | the Vue d'ensemble: résultat net = marge - charges, cash out = every dépense paid | PASS |  |  |
| 13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble | the caisse holds the sale minus the three dépenses | PASS |  |  |
| 13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble | paying the same rent period twice is refused | PASS |  |  |
| 13. Dépenses, loyer au prorata, résultat net de la Vue d'ensemble | cancelling the rent payment gives the cash back and changes no charge | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | an opening sets the balance; a second one is refused | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | a transfer moves money between two accounts and sums to zero | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | a transfer above the balance is refused (CASH_INSUFFICIENT) | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | a comptage needs a reason when it differs, then posts the écart | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | paid at reception is a real règlement, from the caisse | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | that règlement cannot be cancelled alone | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | cancelling the BR cancels its règlement: supplier at zero, cash and stock back | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | cancelling the transfer reverses both sides | PASS |  |  |
| 14. Trésorerie: ouverture, virement interne, comptage, payé à la réception | GET /treasury/reconcile finds no difference | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | last month: 2 % of 10 000 DA HT = 200 DA for the seller | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | the owner approves: the run is frozen | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | approving twice is refused and adds nothing | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | the approved month is not rewritten by the cancellation | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | this month takes the cancelled sale back: CA HT -10 000, prime -200 or 0, never + | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | a frozen run refuses any change in the database itself | PASS |  |  |
| 15. Primes: un mois approuvé, puis une vente annulée le mois suivant | stock and client account are back after the cancellation | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the employee gets matricule EMP-000001 | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | an approved paid leave of 2 working days takes 2 days off the balance | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | a second mark on a marked day is refused (corrections only) | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | an avance is a dépense, an employee ledger row and cash out, in one go | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the avance is cash, not a charge | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the draft payslip: 60 000 - one absent day (2 000), CNAS 9 %, IRG of the barème | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | a draft has no number and posts nothing | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | approval numbers the run PAIE-YYYY-000001 and posts the ledgers | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the approved month is locked: no new mark | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the approved run costs brut + employer CNAS in its month (charges) | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | paying the run: one dépense per employee, salary due at zero, cash out | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the same payment sent again pays nothing more | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | paying a run that is already paid, with a new key, pays nothing and says so | FAIL | 409 or 422: nothing left to pay | nothing was left to pay, no dépense was written, and the API answered 201 as if it had paid |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | a paid run cannot be cancelled | PASS |  |  |
| 16. RH et paie: pointage, congé, avance, paie approuvée et payée | the employee ledger adds up to both balances | PASS |  |  |
| Scenario | scenario completed | PASS | the whole sale/payment/return/cancel chain holds | tenant 664d1691-1600-4e05-ad4c-1f391ac106bf |