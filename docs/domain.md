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
- **Dépôt**: warehouse (multi-dépôts is later; MVP has one implicit dépôt).
- **Timbre fiscal**: stamp duty on cash-paid invoices, rule set by the loi de finances.
