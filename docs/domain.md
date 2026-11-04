# Domain rules – Algerian wholesale (grossiste)

## Products & units
- A product has a **base unit** (pièce, kg, litre) and optional **packaging units** (carton = 24 pièces, fardeau = 6, sac = 25 kg).
- Stock is always stored in the base unit. Sales/purchases can be entered in any unit and converted.
- Barcode per unit is common (one for the pièce, one for the carton).
- Allow decimal quantities only for weight/volume units.

## Prices
- Several price levels per product: **prix de gros**, **prix demi-gros**, **prix détail** (configurable count per tenant).
- A client can be assigned a default price level; the seller may override per line (with permission).
- Store purchase cost (prix d'achat) per entry; compute margin with weighted average cost (CUMP) for MVP.
- The price on a sale line is **frozen at sale time**. Changing a product price never changes past invoices.

## Clients & credit
- Client account = ledger of: sales on credit (+), versements (−), returns/avoirs (−), opening balance (±, from Excel import).
- **Plafond de crédit**: warn or block when a sale would exceed it (tenant setting: warn vs block, role can override).
- Partial payment at sale time is normal: sale 100 000 DA, paid 60 000, 40 000 goes to credit.
- Versement modes: espèces, chèque, virement, (later) CCP/BaridiMob. Cheques can bounce → reversing entry.
- Client statement (relevé de compte) with running balance, printable and shareable (PDF/WhatsApp).
- Aging: how long each client has owed (0–30, 31–60, 61–90, 90+ days), phase 21 below.

## Suppliers (fournisseurs)
- Supplier account (dettes fournisseurs, phase 21) = ledger of: validated BRs (+TTC as the BR stores it), what was paid at reception (−), règlements RGF (−), retours fournisseur (−), opening balance (±, Excel import "Fournisseurs et soldes"). Positive balance = we owe the supplier.
- Cancelling a BR reverses exactly what its BR and retours still leave on the account; cancelling a règlement (MANAGER+, with a reason) brings the debt back. Nothing is deleted.
- Règlements are not allocated to BRs: for the aging, they pay the oldest BR first.

## Importateur: dossiers d'importation, devises, coût de revient (phase 22, module IMPORT_COSTS)
- **Currencies**: a supplier has a `currency` (`DZD` default, `USD`, `EUR`, `CNY`; the list lives in `packages/shared/landed-cost.ts`). It cannot change once the supplier has entries. Its BRs and règlements are in that currency, each with the **bank rate** typed by the user (`exchangeRate`, DZD per 1 unit, 6 decimals). A foreign BR has no Algerian TVA and nothing paid at reception: it is paid by règlement, in its currency.
- A foreign BR line keeps the supplier's price (`unitCostCurrency`) **and** the DZD price; stock, CUMP and the DZD account use the DZD. The supplier account keeps both: each entry has `amount` (DZD) and `amountCurrency`, and the relevé (screen and PDF) shows both balances. No exchange gain/loss is booked (parked): a règlement at another rate than the BR leaves a DZD difference on the account.
- **Dossier d'importation** (`DI-YYYY-000001`): one shipment (container), its BRs and its costs. `OPEN` → `CLOSED`, or `CANCELLED` while open and with no BR in transit (its drafts leave it, its cost lines are reversed). A BR joins or leaves a dossier only while it is a draft.
- **Supplier debts are posted when they are real, stock waits**: validating a BR of an open dossier posts the supplier account as usual but moves no stock; the BR is `IN_TRANSIT` and its goods cannot be sold. Cancelling a BR in transit reverses its account entries and touches no stock. A cost line with a supplier (transitaire, transporteur) posts that supplier's account when it is added; cancelling the line reverses it.
- **Cost lines** (`FRET`, `DOUANE`, `TVA_IMPORT`, `TRANSITAIRE`, `MAGASINAGE`, `TRANSPORT`, `ASSURANCE`, `AUTRE`): amount TTC in DZD or in the cost supplier's currency at a rate, with the TVA inside it, and an allocation method: `VALUE` (DZD value of the line), `QUANTITY` (base units), `WEIGHT` / `VOLUME` (base units × `Product.weightKg` / `volumeM3`; refused with `ALLOCATION_BASIS_MISSING` when a product has none), `MANUAL` (DZD per line, must sum exactly).
- **TVA rule**: for an **assujetti** tenant, TVA à l'importation and the TVA on a cost invoice are recoverable, so they stay out of the coût de revient. For a **non-assujetti** (IFU) tenant they cannot be recovered and are part of the cost, like the TVA of a local BR.
- **Close** (`POST /import-files/:id/close`, idempotent): needs at least one BR in transit and no draft left. In one transaction, locking stock rows by `productId`: for each line, coût de revient = DZD value + its share of each cost, divided by the base quantity, rounded once at storage (4 decimals); each cost's shares are rounded to 2 decimals with the remainder on the line with the largest basis, so they sum exactly to the cost. Then the PURCHASE movements are posted at that cost (CUMP updated), the BRs become `VALIDATED`, audit. A closed dossier cannot be cancelled: corrections go through retours fournisseur, adjustments or late costs.
- **Late cost** (`POST /import-files/:id/late-cost`, idempotent): a cost that arrives after the close is allocated the same way, then per product: the units still on hand (at most what the dossier brought) take their share as a `COST_ADJUST` movement (`qtyBase = 0`, `valueDelta`), which moves the CUMP; the share of units already sold is the **écart de coût**, shown in its own column of the margin report and taken off the margin. Past sales never change. No stock left: everything is écart and the CUMP does not move.
- The **fiche de coût de revient** (A4 PDF) prints the allocation table (per line: value in currency and in DZD, costs, total, coût de revient) and the cost lines.

## Aging, reminders, share links (phase 21)
- **Balance âgée**: each account's balance (the ledger) spread over 0–30 / 31–60 / 61–90 / 90+ days by the age of what is left on each document. Clients use the versement allocations of phase 7; unallocated credit pays the oldest bucket first. The buckets always sum to the balance.
- **Clients à relancer**: balance > 0 and oldest unpaid amount older than the tenant's `reminderDays` (default 30). The WhatsApp button opens `wa.me` with a prefilled message and a share link to the relevé. Nothing is sent automatically.
- **Share links**: a relevé or a facture opened without login through `/s/<token>`, valid 7 days, revocable. Only the token's hash is stored; every opening is counted and audited. A shared facture is not a print (DUPLICATA if the original was printed).
- **Chèques à échéance**: the dashboard lists client and supplier cheques due today and the 6 days after.

## Documents
- **Bon de livraison (BL)**: most daily sales; may not include tax details.
- **Facture**: legal invoice. Can be created directly or from one or several BLs.
- **Avoir**: credit note for returns or corrections.
- **Bon de réception**: purchase entry.
- Numbering: sequential, per tenant, per document type, per year, no gaps.
- Printing: A4 and A5 required; thermal 80mm is for the later caisse.

## Algerian invoice fields (verify current rules before hard-coding rates)
- Seller: raison sociale, adresse, **RC** (registre de commerce), **NIF**, **NIS**, **AI** (article d'imposition), RIB optional.
- Client: name, address, and for businesses their RC/NIF/NIS/AI.
- Lines: désignation, quantité, unité, prix unitaire HT, montant HT.
- Totals: total HT, **TVA** (common rates 19% and 9% – store rate per product, never hard-code), total TTC.
- **Timbre fiscal** applies to cash-paid invoices; its rate/thresholds are set by the loi de finances and change – make it a configurable rule, and check the current law.
- Amount in words (en lettres) in French is expected on factures.
- Many grossistes are on the **IFU** (forfait) regime and don't charge TVA → tenant setting "assujetti TVA: oui/non".

## Excel import (phase 9)
- Three imports: **Produits**, **Stock initial**, **Clients et soldes**, from .xlsx or .csv (10 MB, 10 000 rows max).
- Preview writes nothing but the `ImportJob`. A preview with any error row cannot be confirmed: the trader fixes the file and uploads it again. Warnings do not block.
- Confirm re-validates against current data and writes every row in one transaction; any failure rolls the whole import back and marks the job `FAILED`.
- Matching: products by reference, clients by code. An existing record gets only the non-empty cells (a blank cell keeps the stored value); importing products never touches stock.
- Opening stock and opening balance go through the ledgers (`OPENING`) and are refused for a product/client that already has one, so re-importing the same file never doubles them.
- Numbers accept `1 234,50`, `1.234,50`, `1,234.50`, `1234.5`, `1 234 DA`. A lone `,` is decimal; a single `.` is decimal; several `.` are thousands separators.
- New products: base unit is the default sale and purchase unit; empty TVA means 0 % (shown as a warning). Unknown categories are created.
- The original file is kept 30 days, then dropped; the job row stays for audit.
- Later imports: **Fournisseurs et soldes** (phase 21) and **Emballages** (phase 20, PACKAGING: code client, emballage, quantité → `OPENING` on the packaging ledger).

## Editions (phase 13b)
- One codebase for three kinds of customers. The plan switches modules on (`packages/shared/features.ts`), the API enforces it.
- **Essentiel**: grossiste who buys from distributors and sells en gros (core: everything in phases 1–13 and 21).
- **Import**: importer (e.g. from China) who sells en gros: + dossiers d'importation, devises, coût de revient (phase 22), multi-dépôts.
- **Distribution**: brand distributor with sellers and trucks: + sales force, vehicles, tournées, GPS check, objectifs & primes, mobile app, promotions, emballages.
- Turning a module off never deletes its data: its screens and writes are refused, its reports and exports stay readable, and everything comes back when it is on again.
- Two axes: the **plan** (Starter / Pro / Business) sets the price and the limits (users, products, documents, mobile sellers); the **edition** sets the modules. Price = plan + edition supplement. The super-admin can add or remove one module for one company on top of its edition.
- At signup the company says what it does (grossiste, importateur, distributeur de marque); the trial starts on the matching edition.

## Sales force & distribution (phases 14–20)
- **Vendeur** (SELLER) sells in the shop or on the road; **superviseur** (SUPERVISOR) and **chef des ventes** manage a team through `User.managerId`; **livreur** (LIVREUR) delivers pre-sale orders.
- Every sale has a `sellerId` and every versement a `collectedBy`, frozen like prices. Objectives and bonuses are computed from them.
- **Secteur**: a zone (wilaya + communes); clients belong to a sector and can be assigned to a seller.
- **Marque**: master data of every plan (not only Distribution); a product has at most one. The product import accepts a "Marque" column and creates unknown brands.

### Who sold, who collected, who sees what (phase 14)
- A SELLER always sells in his own name; office roles (owner, gérant, superviseur) pick the seller, a superviseur within his team. The seller is frozen at validation; changing it afterwards (or the collector of a versement) needs the permission "Changer le vendeur", a reason, and is kept in the journal.
- Sales and versements made before phase 14 have no seller / collector: they count for their creator / receiver in reports and in a seller's own scope.
- Tenant setting `sellerScope` (Distribution only): `ALL_CLIENTS` (default, as before) or `ASSIGNED_ONLY`, where a SELLER sees only his assigned clients and his own sales and versements, and a SUPERVISOR those of his team. A client outside the scope answers "not found". The client comptoir stays open. A client a seller creates is assigned to him.
- A seller's figures (dashboard, reports) are always his own, whatever the setting; a superviseur's are his team's.
- Brand figures are computed per line: a document with several brands counts once in each, and line TTC can differ by a centime from the document total.
- **Tournée**: the ordered list of clients a seller visits on given weekdays. **Visite**: one stop, with an outcome (sale, order, payment only, no sale + reason).
- **Vente directe**: the seller sells from his truck and prints the BL on the spot. **Pré-vente**: he takes a bon de commande; a livreur delivers it later and the BL is created at delivery.
- **Camion = dépôt** (`Warehouse` type VEHICLE). Chargement / déchargement are stock transfers. CUMP stays per product for the whole company.

### Dépôts et camions (phase 15, module WAREHOUSES)
- Every company has one **dépôt principal** (MAIN, created at signup). Without the module it is the only one and nothing changes. With it: other dépôts (SECONDARY) and trucks (VEHICLE, at most one per seller, one seller per truck).
- The stock of a product = the sum of its dépôts, always. The **CUMP is per product for the whole company**, never per dépôt: moving goods never changes it.
- **Transfert** (`TR-YYYY-000001`): **chargement** (dépôt → camion), **déchargement** (camion → dépôt), **transfert** (anything else). The type follows from the two dépôts. A draft has no effect; validation moves the goods at the current CUMP; cancelling a validated one moves them back (never deleted). The bon de chargement prints quantities only, no prices.
- Where the goods go, by default: a **sale** leaves from the chosen dépôt, else the seller's truck, else the dépôt principal; a **retour client** and the cancel of a sale go back where the sale left from; a **BR** enters the dépôt principal unless another is chosen, and its cancel / retour fournisseur leave from that same dépôt; opening stock, adjustments and the Excel import use the dépôt principal unless one is chosen.
- **Stock négatif** is judged per dépôt: 10 cartons at the dépôt do not cover a sale from an empty truck (BLOCK refuses it, WARN warns).
- An **inventaire** counts one dépôt: "expected" is that dépôt's quantity.
- A dépôt is archived only when empty (move the stock out with a transfer first); the dépôt principal is never archived or deactivated.
- **Clôture de tournée**: at the end of the day the API computes the cash the seller must hand over; the manager enters what he handed; the écart is stored and audited.

### Dépôts as business units: teams, permissions, access (phase 24, module MULTI_UNIT)
- One company, one tenant. A MAIN or SECONDARY dépôt is a **business unit** (e.g. "Vaisselle" for brand A, "Vêtements" for brand B). Products, clients, price levels and the CUMP stay company-wide.
- **One client account across dépôts**: one ledger, one balance, one plafond. Each ledger entry and versement records its dépôt, so debts and cash can be shown per dépôt; the parts always add up to the balance. Opening balances and adjustments use the dépôt chosen, else the user's only dépôt, else the dépôt principal; an Excel import uses the dépôt principal.
- **What a user may do**: permissions per module (view / create / edit / cancel) plus the sensitive actions of earlier phases. Role defaults give every role exactly what it could do before phase 24 (checked route by route by `route-access.spec.ts`). The owner always has everything. A user who manages users or access never gives more than he has, and never touches an owner.
- **Where he may do it**: per dépôt, **Travailler** (OPERATE: sells, receives, sees its documents) or **Voir les statistiques** (VIEW_STATS: its dashboard, reports and sell-out figures, never a single document, client ledger detail or user list). The owner and "Tous les dépôts" (VIEW_ALL_WAREHOUSES) see every dépôt. A truck belongs to one dépôt and follows it: working in a dépôt includes its trucks, and a seller always works in the truck he drives.
- Outside his reach a document is **not there** (404, empty list), never an error that reveals it. A user who works in exactly one dépôt gets it by default on a sale, BR, order, versement, inventaire, opening stock or adjustment. A transfer is changed by someone who works where its goods leave from.
- **What a dépôt sells**: its brands and its categories (sub-categories included); none = everything. A truck sells what its dépôt sells. A sale or order line on another product is refused (`PRODUCT_NOT_IN_WAREHOUSE`) unless the user has "Vendre tout produit" (SELL_ANY_PRODUCT).
- The **client statement** shows the whole account; a line of a dépôt the user does not work in only shows its date, type, number, amount and dépôt (no note, no author, no link to the document).
- A user invited after phase 24 works in the dépôts of whoever invited him (every dépôt when the owner invites); whoever creates a dépôt works in it. The owner narrows access on the user's page.
- Not in this phase: separate client accounts or plafonds per dépôt, inter-dépôt invoicing / transfer pricing, a different role per dépôt.

### Géolocalisation
- Each client has a reference GPS point. Sellers cannot move it without approval.
- Sales, versements and visits carry the phone's position at the time of the operation (never continuous tracking, law 18-07). The API computes the distance and stores a `GeoCheck`: OK, FAR, MOCKED, LOW_ACCURACY, NO_CLIENT_GPS, NO_SIGNAL.
- Default is to **flag, not block**: a far operation needs a note and is reviewed by a manager (justified / not justified). Blocking is a tenant setting.
- Rules (phase 17), first match wins: no position → `NO_SIGNAL`, mock flag → `MOCKED`, accuracy above `geoMaxAccuracyM` → `LOW_ACCURACY`, client without a point → `NO_CLIENT_GPS`, distance ≤ `geoRadiusM` + accuracy → `OK`, else `FAR`. `LATE_SYNC` is added when the position was taken more than 2 h before the server got it (offline replay). Every status except `OK` and `NO_CLIENT_GPS` needs the seller's note (`GEO_NOTE_REQUIRED`, nothing is saved without it). In `BLOCK` mode `FAR` and `MOCKED` are refused unless the user has `GEO_OVERRIDE`.
- Who is checked: the field roles (SELLER, LIVREUR), on a sale's **validation** (quick sale or draft validated, not the draft itself), a versement and a visit. Office staff selling at the counter and the client comptoir are not checked. The check is written in the document's transaction: one `GeoCheck` per document, so an idempotent replay creates none. It stores the client's point used for the distance, since that point can move later.
- The client's point is set once by anyone who stands there; after that a seller asks for a change (`ClientGeoChangeRequest`), which a manager or a supervisor above that seller approves or rejects. Office roles move it directly. Every change is audited with the point before and after.
- A review is an append-only `GeoCheckReview` row; the latest verdict is cached on the `GeoCheck` in the same transaction. Supervisors see their team's flags, only managers give the verdict.

### Objectifs & primes
- Companies set monthly targets per seller or team (CA HT, quantity by brand/product, encaissements, margin, new clients, visits) and bonus rules from five types: fixed on target, tiers (highest reached or progressive), commission %, amount per unit, manager override on the team; with gates (e.g. recouvrement ≥ 70 %) and a cap.
- An avoir counts in the month it is validated, so a return after an approved month lowers the next month.
- Month end: preview → owner approves → frozen → Excel export. With the PAYROLL module (phase 31b) an approved run is also pulled into the paie as a prime.
- Rules (phase 18, module INCENTIVES), so an approved month is never rewritten:
  - A sale counts in the month it is validated; if it is cancelled later, what was left of it (not returned yet) is taken back in the month of the cancellation. An avoir counts in the month it is made, for the seller of the sale (of the BL when the avoir is on a facture made from BLs). A facture made from BLs never counts: its BLs did.
  - A versement counts when received; a cancel or a bounce takes it back in its own month. Legacy documents (no seller / collector) count for their creator / receiver.
  - **Recouvrement %** = versements not paid at the sale ÷ what the period's sales left on credit (TTC − paid at the sale), 100 % when nothing was on credit. **Strike rate** = visits with a sale or an order ÷ visits. **Opérations non justifiées** = GeoChecks reviewed NOT_JUSTIFIED, by the operation's date.
  - A scope (brand, category with its sub-categories, product) only applies to CA, quantity and margin. "Per unit" counts whole units (in the chosen unit of the product).
  - A team target covers the manager's whole subtree (`managerId`, any depth); without its own target a team gets the sum of its members' targets. A quarter plan adds up the three months' targets.
  - An ACTIVE plan is never edited: a change is a new version (DRAFT copy) with its own start month; activating it ends the previous version the day before.
  - Approving (the owner, or a user granted "Valider les primes") freezes the run and its lines (DB triggers) and locks the period: no seller / collector change on its documents and no target change (`PERIOD_APPROVED`). Margin figures stay hidden without "Voir coûts et marges".

### Promotions & emballages
- **UG (unités gratuites)**: "10+1" free units are separate lines at price 0 that leave stock; their cost lowers the margin.
- **Emballages consignés** (casiers, palettes, bouteilles): a per-client count ledger, + when delivered, − when returned.
- Rules (phase 20, modules PROMOTIONS and PACKAGING):
  - A promotion is `FREE_UNITS` (buy N of X, get M of X or of Y free; repeatable: 25 bought with 10+1 gives 2) or `PERCENT_DISCOUNT` (on products, a brand, or a category with its sub-categories; optional minimum quantity in base units). It covers all clients, a price level, a sector or a list of clients, between two Algiers days (both included).
  - **The API applies them** when it prices lines: a sale draft or quick sale, an order draft and its confirmation. The day that counts is the day the lines are priced; validating a draft keeps what it was priced with (like prices). An order is priced again at confirmation (list prices and promotions of that day). The web shows the API's preview (`POST /pricing/preview`).
  - At most one promotion per line, and each line is judged alone (two lines of the same product are not added up). The highest priority wins; a tie goes to the best for the client (the free units valued at the client's list price, or the remise in DA), then to the oldest promotion. Free lines are never a target.
  - A free line is its own line: price 0, `isFree`, the promotion's id and **name frozen**, and `freeOfPosition` pointing to its paid line. It leaves stock at the CUMP like any line, so its cost lowers the margin; its "valeur des gratuités" is its quantity × the client's list price kept on the line. Editing or archiving a promotion never changes a past document.
  - Changing the free quantity or a promotion's remise needs **PROMO_OVERRIDE** (managers by default); it is audited (`PROMO_OVERRIDE_USED`). Free units without a promotion are refused.
  - **Returns**: only paid lines are picked; the free units come back by themselves, in proportion to the paid units returned **so far** (cumulative, so several small returns end where one big return would), rounded half-up to whole units (to 0.001 for a decimal unit). Returning all the paid units brings back all the free ones. Example: 25 cartons with 2 free; return 10 → 2 × 10 / 25 = 0.8 → 1 free back; return the other 15 → the last one.
  - **Order delivery**: free units go with their paid line by the same proportion rule. A facture made from BLs keeps the free lines.
  - **Objectifs & primes**: free units count as 0 quantity (no bonus "per unit" on a gift), but their cost stays in the margin.
- Emballages (phase 20):
  - A product may travel in one or more packaging types (1 casier per 24 bouteilles). A validated sale to a client posts `DELIVERY` = ceil(quantity in base units ÷ per packaging) for each line, free lines included (30 bouteilles = 2 casiers). Empties the client hands back are entered on the sale (or the delivery) and post `RETURN`. The client comptoir has no packaging account.
  - Manual movements (`POST /packaging-movements`, idempotent): `RETURN` by anyone who sees the client, `ADJUST` (signed, with a note) by managers. Opening counts come from the Excel import "Emballages" (`OPENING`, refused twice for a client and a packaging).
  - Cancelling a sale posts `REVERSAL` of exactly what that sale left (given − returned). An avoir does not move packaging: empties are entered when they come back.
  - A count can go below zero (openings may be missing at the start): the API answers with a warning, never a refusal. Counts only: the deposit value is shown, no money is posted (money consigne is parked).
  - Same ledger rules as money: `ClientPackagingEntry` is append-only, the cached `ClientPackagingBalance` is updated in the same transaction (locked after the client balance) and checked by the nightly reconcile.
- **Sell-out par marque** (`GET /reports/sell-out`, owner, manager, supervisor for his team): month × brand × product × sector × seller × client type, in base units and HT. Same counting rules as the other reports (a sale in the month it is validated, an avoir in the month it is made, factures from BLs excluded). Sold, free (UG) and returned quantities are separate columns; free units brought back lower the free columns. The sector is the client's current one; the client type is the one frozen at validation. The Excel export has fixed French column titles (`SELL_OUT_COLUMNS`): never rename or reorder them, only add at the end.

## Charges et loyers (phase 25, module EXPENSES)
- In **every edition**. Dépôt-level parts (the Loyer block of a dépôt, figures by dépôt) only show with `MULTI_UNIT`.
- **Dépense** (`DEP-YYYY-000001`): date, dépôt, category, amount, mode (espèces / chèque / virement), reference, payee, optional period covered (`periodStart..periodEnd`), note. Immutable once saved: a mistake is cancelled (reason, `EXPENSE_CANCEL`) and entered again. Idempotent POST, audited.
- **Dépôt of a dépense**: with `MULTI_UNIT` the one chosen, else the user's only dépôt, else the dépôt principal, and the user must work there (phase 24 rules: outside his reach a dépense is not there). Without it the dépôt is optional. A truck's dépenses count for its dépôt in the reports.
- **Categories**: a tenant list seeded at signup (Loyer, Électricité / eau, Salaires, Transport / carburant, Téléphone / internet, Autre), master data with soft delete. Seeded ones keep a `key`; `RENT` (Loyer) is never archived.
- **Bail** (`RentContract`): dépôt (never a truck), landlord, amount, `MONTHLY` / `QUARTERLY` / `YEARLY`, start, optional end. Periods start on the contract's start day (a lease from the 15th runs 15th → 14th; from the 31st, the day is clipped to short months). A bail is **never edited after a valid payment**: a new rent closes it (`endDate`, never before what is already paid) and opens a new one, so past months keep their cost. Never deleted.
- **Rent cost of any period is computed, never stored** (`packages/shared/src/rent.ts`): each day inside a contract period costs `amount / days of that period`, so October of a 1 200 000 DA yearly lease is 1 200 000 × 31 / 365. It is the charged cost (accrual), whatever was paid. No rounding inside the computation.
- **Rent payment** = a dépense linked to its bail, category Loyer, covering **whole periods** of the bail, inside it and not already paid (`RENT_PERIOD_INVALID`). Its amount is what was really paid. The bail shows *payé jusqu'au* (end of the first run of paid periods), the next due date and the amount due (periods started and not paid). Alerts: a period due and unpaid, and 30 days before the bail's end. Cancelling a payment makes its periods due again.
- **Charges of a period** (`GET /reports/charges`, managers, over the dépôts whose figures the user sees): rent from the baux (accrual) + every other dépense, spread by day over its period, or on its date without one. **Loyer payments linked to a bail are cash only**: they are shown apart (*loyers payés*) and never added, so rent is not counted twice. A Loyer dépense without a bail counts like any dépense. Each category × dépôt cell is rounded once (half-up, 2 decimals); every total is the sum of the rounded cells, so the parts always add up.
- Not in this phase: payroll, supplier invoices for services, depreciation, a full cash book, attachments.

## DRH: personnel et pointage (phase 31, module HR)
- Editions DISTRIBUTION and ENTREPRISE, grantable per tenant. Dépôt-level parts only show with `MULTI_UNIT`. Payroll is phase 31b: this phase stores what it needs.
- **Employé** (master data, soft delete, matricule `EMP-000001` per tenant, never restarting). Most have no app account; `userId` links at most one. With `MULTI_UNIT` a dépôt (never a truck) is required. `declared` is free: the app never refuses an undeclared worker.
- **Salary** is append-only (`EmployeeSalary`): the salary of a day is the last row on or before it, so a raise never changes a past month.
- **Pointage = append-only events** (`AttendanceEvent`). Each event keeps the employee's dépôt at the time. A second status on a marked day is refused (`ATTENDANCE_ALREADY_MARKED`): replacing it is a `CORRECTION` (reason, `ATTENDANCE_CORRECT`). A correction back to `UNMARKED` undoes a wrong tap. Future days are refused. "Tous présents" skips days already marked, leaves and days off, so it never overwrites an absence.
- **Day status is derived** (`deriveDayStatus`, `packages/shared/src/attendance.ts`). First match wins: `NOT_EMPLOYED` → a correction → an approved leave on a working day → a day worked on a rest day or holiday → `HOLIDAY` (beats a rest day) → `REST` → the day's last mark → `UNMARKED`. `LATE` and `CHECK_IN` mean present; `OVERTIME` and `CHECK_OUT` change nothing. A day never marked stays `UNMARKED`, never "present". A day still to come counts for nothing in the month's figures.
- **`AttendanceDay`** caches days that have an event or an approved leave, in the same transaction, and is reconciled nightly. Other days have no row: they are derived on read by the same function.
- **Month lock**: `AttendanceMonthLock` (written by 31b when a payroll is approved; a dépôt, or null for the company) refuses new events and freezes cached days (`PERIOD_APPROVED`, services first, DB trigger behind). Until then a manager may correct any past day.
- **Calendar**: tenant rest days (default Friday), daily hours, an employee's own rest days override. Fixed fêtes are seeded for this year and the next, at the first employee and every night. Lunar fêtes are entered by the tenant, with a reminder. A fête entered or removed late recomputes that date and posts an `ADJUST` on approved paid leaves covering it, so nobody loses a congé day because Aïd was entered late. Refused inside a locked month.
- **Congés**: `LeaveEntry` ledger in days (`ACCRUAL`, `TAKEN`, `ADJUST`, `OPENING`), balance cached and reconciled. Accrual: 2.5 days per month (tenant setting) for every contract type, prorated by calendar days employed, one decimal half-up, posted nightly for the previous month to whoever lacks it (one per employee and month). A request goes `PENDING` → `APPROVED` / `REJECTED`. **Only a `PAID` leave posts `TAKEN`** (working days only); `UNPAID` / `SICK` / `OTHER` only change the day's status. Beyond the balance is a warning, never a refusal. Cancelling an approved leave posts the reverse entry.
- **Avance sur salaire**: one transaction: a dépense (category Salaires, `employeeId`), an `EmployeeLedgerEntry` `ADVANCE` and the audit row. Cancelled with the dépense (`REVERSAL`). **Cash, not a charge**: the charges report leaves it out, the overview's cash figures keep it. `OPENING` is an avance already running at import: no dépense behind it.
- **Pay is hidden** without `SALARY_VIEW` (owner by default): salaries, RIB, pay type, avances, the employee ledger, avance dépenses (not there in `/expenses`, even by id) and their journal lines. So a manager's dépenses list can be lower than the overview's cash out. `ADVANCE_PAY` is the owner's by default too, and needs `SALARY_VIEW`.
- **Who sees whom**: the employees of the dépôts where the user has OPERATE; statistics access gives counts only; outside his reach an employee is not there (404).
- **Self check-in** (`GEO_CHECK` and the tenant setting): the phase 17 rules against the dépôt's point, one position per tap, never tracking (law 18-07). Flag, not block: a far or mocked check-in needs a note and is reviewed in Opérations signalées. A tap never overrules a manager's absence or an approved leave.
- **Excel import** creates employees only, with salary and opening congé and avance balances: a name already on file is refused, so a second run doubles nothing. It needs `HR_MANAGE` and `SALARY_VIEW`.
- Not in this phase: biometric devices, shifts, recruitment, staff documents. Payslips, CNAS / IRG and salary payment are phase 31b.

## DRH: paie (phase 31b, module PAYROLL)
- Editions DISTRIBUTION and ENTREPRISE, grantable per tenant, and off without HR. Everything here needs `SALARY_VIEW`; approving (`PAYROLL_APPROVE`), managing (`PAYROLL_MANAGE`) and paying (`PAYROLL_PAY`) are the owner's by default.
- **An Algerian comptable must check the rates, the barème and the rounding before the first real payslip.** Rates are dated rows, never constants.
- **`PayrollRateSet`**: country-wide, owned by the super-admin, append-only (a correction is a new row; latest date, then latest row, valid on the month's last day). `toVerify` shows a banner and a line on the PDF; it never blocks. Seeded in the migration, because production does not run the seed.
- **Computation** (`packages/shared/src/payroll.ts`, pure, one function per step). Each line is rounded half-up to 2 decimals and totals are the sum of the rounded lines, so a bulletin adds up to the centime. The IRG is rounded down to the dinar.
  - **Monthly**: base − base / day divisor × (unjustified, justified, unpaid leave, sick days; a half day 0.5). Deductions never exceed the base. A rest day or holiday worked adds base / day divisor, without premium. All justified absences are deducted (nothing marks one as paid): a one-off line gives the money back.
  - **Hired or left during the month**: days outside the contract are taken **against the month's own length, never the divisor** (calendar days with divisor 30, working days with 26 / 22), so the days worked always keep their pay. Hired on 31 October, a 45 000 DA salary pays 45 000 / 31.
  - **Daily**: rate × days present + paid leave + paid holidays. Overtime and lateness use rate / `hrDailyHours`; a monthly worker, base / hourly divisor.
  - A salary changed during the month applies to the whole month (the one on the last day).
  - **Brut cotisable** = base after absences + overtime + cotisable primes. **CNAS** on it, only when `declared`. **Imposable** = brut − CNAS − non-imposable items. **IRG**: barème on 1/12 of each annual bracket, abattement 40 % between 1 000 and 1 500, 0 up to 30 000, and between 30 000 and 35 000 the lissage on the IRG after abattement. **Net** = brut − CNAS − IRG. **Net à payer** = net − retenues − avances (retenues first; the avance takes what is left and the rest carries over).
  - Undeclared: no CNAS, no IRG, net = brut; his document is a *reçu de paie*, never a bulletin.
- **`PayrollRun`** per month and dépôt, or for the company (`warehouseId` null). One live run per month and dépôt; a company run and a dépôt run of the same month are refused; someone on an approved payslip of the month is left out of other runs. Without `MULTI_UNIT` a run is the company's. A company run needs a user who reaches every dépôt.
- **DRAFT** is computed again at will; manual lines (one-off prime, signed régularisation, retenue) survive it. **Approve** recomputes in the transaction under employee locks and refuses `PAYROLL_STALE` if anything moved since the owner read it; unmarked days (future days included), a missing salary or a net below zero block it. Then, in one transaction: number `PAIE-YYYY-000001` (given here, so abandoned drafts leave no gap), month lock, ledgers, audit. Triggers refuse any change to an approved run and its payslips (`PERIOD_APPROVED`).
- **Month lock**: the dépôt's row, plus one row per employee of a dépôt run, because a worker who moved keeps days in his old dépôt and a worker without dépôt has none. The calendar is the company's: any lock of a month stops a fête change there.
- **Employee ledger, two balances**: `advanceBalance` and `salaryDue`, so an unpaid salary never hides a running avance. `SALARY_DUE` (net − retenues), `SALARY_PAID`, `SALARY_REVERSAL` move the salary owed; `ADVANCE_DEDUCTION` moves both (`employeeBalanceDelta`); the rest moves the avances. `balanceAfter` is the balance the type moves.
- **Payments** (`POST /payroll-runs/:id/payments`, idempotent): whole run, chosen employees, or part of what remains. Per employee, one dépense (Salaires, linked to the run and the employee) and one `SALARY_PAID`. Paid / remaining is always derived from the VALID dépenses: cancelling the dépense in *Dépenses* makes the salary due again.
- **Cancel**: a draft is dropped; an approved run only while nothing is paid: ledgers reversed, month reopened, number kept on the cancelled run. After a payment a mistake is a **régularisation** in a later month.
- **Charges**: the approved run costs brut + employer CNAS in its month, spread by day like rent, in the Salaires × dépôt cell of the payslip. Salary payments and avances are cash only. A Salaires dépense entered by hand, with no employee, still counts: the run screen warns about it. Managers without `SALARY_VIEW` see the Salaires total in charges, or the résultat net would not add up.
- **Incentives**: approved and exported runs ending this month or the one before come in as one cotisable, imposable line per run and seller, read only, linked to his employee by `userId`. A run is paid once (each line keeps its source), so one approved late goes to the next payroll. Older periods went through the Excel export. A seller with no employee file is named on the run.
- **Documents**: bulletin A4, reçu A5, bulk PDF, approved runs only. Excel with fixed French titles, never renamed or reordered: livre de paie, état CNAS, récapitulatif IRG, DAS annuelle. Declared workers only in the last three.
- **Mes bulletins**: a user with an employee file sees his own approved payslips, without `SALARY_VIEW`.
- Not in this phase: CNAS electronic filing (Excel only until the format is checked with the comptable), bank transfer files, special IRG cases, 13th month, leave pay indemnity, sick pay advance, solde de tout compte.

## Vue d'ensemble (phase 26, module MULTI_UNIT)
- `GET /reports/overview?from=&to=` (managers: `REPORTS_FINANCE`): one card per dépôt (MAIN / SECONDARY) whose figures the user sees (OPERATE or VIEW_STATS), then the total. A dépôt outside his reach never appears, not even its name. An archived dépôt shows only while it has figures in the period.
- **What counts for a dépôt**: its own rows and its trucks' (a truck is part of its dépôt's business unit); a row without a dépôt is the dépôt principal's. Since phase 26 the dashboard and the reports filtered on a dépôt include its trucks too, so a card always equals the dashboard filtered on its dépôt.
- **Same definitions as the other screens**: CA = TTC net of avoirs (dashboard, `saleDocumentFacts`); marge = HT net − cost at sale (`saleLineFacts`, without the late-import écart, as in every dépôt-scoped figure); charges = the phase 25 charges report; résultat net = marge − charges. Comparison: the same number of days just before the period; no % when it had no sales.
- **Cash**: encaissements = versements received; décaissements = règlements fournisseur + dépenses paid in the period (rent payments included: this is cash, not the charged cost). A **règlement fournisseur records its dépôt** (phase 26): the one asked for (in the user's reach), else his only dépôt, else none (counts for the dépôt principal).
- **Créances** are today's, whatever the period: what each client owes each dépôt (his ledger split by dépôt; only positive parts count, so the total can exceed the dashboard's when a client has a credit in one dépôt and a debt in another). The share over 90 days ages each part like the balance âgée, over that dépôt's documents and that dépôt's versements (`agedOver90`, the 90+ bucket of `computeAging` from three sums).
- **Totals** are the sum of the cards; only counts are company-wide (a product low in two dépôts counts once, a client owing two dépôts is one debtor). Margin, stock value and net result need `VIEW_COST_AND_MARGIN`; charges need the EXPENSES module. Excel export (`EXPORT_DATA`) with fixed French column titles.
- The dashboard shows the **résultat net du mois** (marge − charges, same dépôt filter) for managers with `VIEW_COST_AND_MARGIN`, with or without `MULTI_UNIT`.
- Not in this phase: budgets / objectives per dépôt, forecasting, the Flutter owner app.

## Typical edge cases to always consider
- Selling the last carton from two devices at the same time.
- Negative stock (allow with warning? tenant setting) – common in real shops because entries are late.
- Return of part of a sale after it was invoiced.
- Client pays more than he owes (credit in his favour).
- Editing a sale after printing → cancel + recreate, keep both in history.
- Price level changed for a client mid-month.

## Tenant settings (Phase 1 creates them, later phases use them)
| Setting | Values | Used by |
|---|---|---|
| `assujettiTva` | true / false (IFU forfait = false) | documents, totals |
| `creditLimitMode` | `WARN` / `BLOCK` | sales over plafond |
| `negativeStockMode` | `ALLOW` / `WARN` / `BLOCK` | sales, adjustments |
| Invoice header | raison sociale, adresse, téléphone, RC, NIF, NIS, AI, RIB (optional), logo (later) | all printed documents |
| `priceLevelCount` | 1 to 5, default 3 (gros, demi-gros, détail) | products, clients |
| `reminderDays` | 1 to 365, default 30 | clients à relancer |
| `sellerScope` | `ALL_CLIENTS` / `ASSIGNED_ONLY`, default `ALL_CLIENTS` | clients, sales, versements seen by sellers (SALES_FORCE) |
| `geoCheckMode` | `OFF` / `FLAG` / `BLOCK`, default `FLAG` | sales, versements, visits of sellers (GEO_CHECK) |
| `geoRadiusM` | 20 to 5000 m, default 150 | distance still counted "at the client" (GEO_CHECK) |
| `geoMaxAccuracyM` | 10 to 5000 m, default 200 | positions less precise are `LOW_ACCURACY` (GEO_CHECK) |
| `hrRestDays` | one or two weekdays (0 = Sunday), default Friday | calendar, day status, leave days (HR) |
| `hrDailyHours` | 1 to 24, default 8 | calendar, hourly rate of a daily worker (HR, PAYROLL) |
| `hrLeaveAccrualDays` | default 2.5 | congés earned per month (HR) |
| `hrSelfCheckIn` | true / false, default false | check-in from the phone (HR + GEO_CHECK) |
| `payrollDayDivisor` | 30, 26 or 22, default 30 | value of an absent day (PAYROLL) |
| `payrollHourDivisor` | default 173.33 | hourly rate of a monthly worker (PAYROLL) |
| `payrollOvertimeRate` | default 0.50 (+50 %) | overtime (PAYROLL) |
| `payrollDeductLateness` | true / false, default false | lateness taken from pay (PAYROLL) |
| Timbre fiscal rule | configurable rate, min, max, threshold; off by default | factures paid in cash |

## Glossary (French term → meaning in code)
- **Grossiste**: wholesaler, our customer (= tenant).
- **Bon de livraison (BL)**: delivery note, the everyday sale document. `DocType.BL`, prefix `BL`.
- **Facture**: legal invoice, prefix `FAC`. Can be made from one or several BLs.
- **Avoir**: credit note for returns or corrections, prefix `AV`.
- **Bon de réception (BR)**: purchase entry from a supplier, prefix `BR`.
- **Versement**: payment received from a client, prefix `VER`.
- **Crédit / dette**: what a client owes. Positive client balance = client owes us.
- **Plafond (de crédit)**: credit limit per client.
- **Relevé de compte**: client statement with running balance.
- **Prix de gros / demi-gros / détail**: price levels.
- **CUMP** (coût unitaire moyen pondéré): weighted average cost.
- **Inventaire**: physical stock count producing adjustments.
- **Dépôt**: warehouse (MVP has one implicit dépôt; multi-dépôts and trucks come in phase 15).
- **Timbre fiscal**: stamp duty on cash-paid invoices, rule set by the loi de finances.
- **Vendeur / superviseur / livreur**: SELLER / SUPERVISOR / LIVREUR roles.
- **Tournée**: sales route (`Route`). **Visite**: `Visit`. **Secteur**: `Sector`. **Marque**: `Brand`.
- **Bon de commande (BC)**: pre-sale order, prefix `BC`, no stock or ledger effect until delivered.
- **Chargement / déchargement**: LOAD / UNLOAD stock transfer to / from a truck, prefix `TR`.
- **Clôture de tournée**: `SellerSession` closing with the cash écart.
- **Objectif / prime / commission**: `SalesTarget` / `IncentiveRule` / `IncentiveRun`.
- **UG**: unités gratuites, free units of a promotion.
- **Emballage consigné**: returnable packaging tracked per client (`PackagingType`, `ClientPackagingEntry`).
- **Sell-out**: what the distributor sold to its clients, per brand, sent to the brand every month.
- **Règlement fournisseur**: payment to a supplier, prefix `RGF`.
- **Vue d'ensemble**: the owner's one-screen view of every dépôt (`/vue-ensemble`). **Résultat net**: marge brute − charges of a period. **Encaissements / décaissements**: cash in (versements) / cash out (règlements fournisseur + dépenses).
- **Dépense**: a charge the company paid (rent, electricity, salaries...), prefix `DEP`. **Bail**: a rent contract of a dépôt (`RentContract`). **Charges**: rent by day + other dépenses of a period.
- **Pointage**: attendance (`AttendanceEvent`, `AttendanceDay`). **Congé**: leave (`LeaveRequest`, `LeaveEntry`). **Avance sur salaire**: an advance on pay (`EmployeeLedgerEntry` `ADVANCE`). **Matricule**: employee number, prefix `EMP`. **Fête légale**: `PublicHoliday`.
- **Dossier d'importation (DI)**: one import shipment grouping BRs and their costs. **Coût de revient**: landed unit cost.
