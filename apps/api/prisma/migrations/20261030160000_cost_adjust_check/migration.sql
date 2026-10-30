-- Phase 22: a COST_ADJUST movement changes the stock value, not the quantity: qtyBase 0
-- with a valueDelta. Every other movement still moves a quantity, and only a zero-quantity
-- movement may carry a valueDelta.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_qtyBase_check";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qtyBase_check"
  CHECK (("qtyBase" <> 0 AND "valueDelta" IS NULL) OR ("qtyBase" = 0 AND "valueDelta" IS NOT NULL));
