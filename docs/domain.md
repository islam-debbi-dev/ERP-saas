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
- Month end: preview → owner approves → frozen → Excel export for payroll. The software computes bonuses; it does not do payroll.
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
- **Emballage consigné**: returnable packaging tracked per client.
- **Règlement fournisseur**: payment to a supplier, prefix `RGF`.
- **Dossier d'importation (DI)**: one import shipment grouping BRs and their costs. **Coût de revient**: landed unit cost.
