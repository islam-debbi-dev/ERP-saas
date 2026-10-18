Read AGENTS.md and docs/domain.md (Products & units, Prices) before doing anything.

## Task: Phase 2 — Products, units, price levels, barcodes

Branch: `phase-02-products`. Phase 1 is merged.

### Domain rules to respect
- Each product has one **base unit** (pièce, kg, litre, mètre) and optional **packaging units** (carton = 24 pièces, fardeau = 6, sac = 25 kg) with `factorToBase` (Decimal, > 0).
- Decimal quantities allowed only when the base unit allows it (`unit.allowsDecimal`, true for kg/litre/mètre).
- Barcode is per unit (pièce barcode ≠ carton barcode), unique per tenant across all units.
- Price levels: tenant has `priceLevelCount` levels (default: Gros, Demi-gros, Détail; names editable). A product has one price per level **per unit** (carton price is not always 24 × pièce price).
- TVA rate per product (0, 9, 19 stored as a value, never hard-coded in logic). Ignored in totals when the tenant is not `assujettiTva`.
- Purchase cost is not edited here; it comes from purchases (phase 4) and opening stock (phase 3). Show the current CUMP read-only once it exists.
- Soft delete only (`deletedAt`). A product used in any document can be archived, never removed.

### API
- Prisma models: `Category` (tree, one level of nesting is enough), `Unit` (tenant-level catalog seeded with pièce, kg, litre, mètre, carton, fardeau, sac, boîte, paquet), `Product` (reference/code unique per tenant, designation, categoryId, baseUnitId, tvaRate, minStock, active, deletedAt), `ProductUnit` (productId, unitId, factorToBase, barcode, isDefaultSale, isDefaultPurchase), `PriceLevel`, `ProductPrice` (productId, productUnitId, priceLevelId, priceHt Decimal(14,2)).
- Endpoints: CRUD categories; CRUD products with nested units and prices in one transaction; `GET /products?search=&categoryId=&cursor=` (search on reference, designation, barcode); `GET /products/by-barcode/:code` returning product + matched unit (used by the sale screen); price level rename.
- Shared zod schemas for create/update product; unit conversion helpers `toBase(qty, factor)` / `fromBase` in `packages/shared` with tests (rounding to 3 decimals).
- Audit log on create/update/archive. Changing a price writes the old and new value.

### Web
- Produits list: TanStack Table, server pagination, search box focused on load, barcode scan in the search box jumps to the product.
- Product form: general info, units table (add carton with factor), price grid (units × price levels), TVA select.
- Catégories management, price level names in Paramètres.

### Tests
- Unit conversion and price helpers.
- Integration: create product with 2 units and 3 price levels in one call; duplicate barcode in same tenant → `409 BARCODE_ALREADY_USED`; same barcode in another tenant is allowed; tenant isolation on product read; archived product not returned by default search.

### Definition of done
AGENTS.md §10. Summary ends with What / How to test manually / Decisions / Next phase (Stock).
