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
- Aging: how long each client has owed (0–30, 31–60, 61–90, 90+ days) – v1.1.

## Suppliers (fournisseurs)
- Bon de réception increases stock and (later) the supplier ledger. Supplier accounts are v1.1.

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
- **Tournée**: the ordered list of clients a seller visits on given weekdays. **Visite**: one stop, with an outcome (sale, order, payment only, no sale + reason).
- **Vente directe**: the seller sells from his truck and prints the BL on the spot. **Pré-vente**: he takes a bon de commande; a livreur delivers it later and the BL is created at delivery.
- **Camion = dépôt** (`Warehouse` type VEHICLE). Chargement / déchargement are stock transfers. CUMP stays per product for the whole company.
- **Clôture de tournée**: at the end of the day the API computes the cash the seller must hand over; the manager enters what he handed; the écart is stored and audited.

### Géolocalisation
- Each client has a reference GPS point. Sellers cannot move it without approval.
- Sales, versements and visits carry the phone's position at the time of the operation (never continuous tracking, law 18-07). The API computes the distance and stores a `GeoCheck`: OK, FAR, MOCKED, LOW_ACCURACY, NO_CLIENT_GPS, NO_SIGNAL.
- Default is to **flag, not block**: a far operation needs a note and is reviewed by a manager (justified / not justified). Blocking is a tenant setting.

### Objectifs & primes
- Companies set monthly targets per seller or team (CA HT, quantity by brand/product, encaissements, margin, new clients, visits) and bonus rules from five types: fixed on target, tiers (highest reached or progressive), commission %, amount per unit, manager override on the team; with gates (e.g. recouvrement ≥ 70 %) and a cap.
- An avoir counts in the month it is validated, so a return after an approved month lowers the next month.
- Month end: preview → owner approves → frozen → Excel export for payroll. The software computes bonuses; it does not do payroll.

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
