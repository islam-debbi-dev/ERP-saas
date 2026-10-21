-- Dashboard and reports (phase 10): period scans by tenant. Indexes only.

-- CreateIndex
CREATE INDEX "sales_tenantId_status_validatedAt_idx" ON "sales"("tenantId", "status", "validatedAt");

-- CreateIndex
CREATE INDEX "sale_returns_tenantId_createdAt_idx" ON "sale_returns"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "purchases_tenantId_status_validatedAt_idx" ON "purchases"("tenantId", "status", "validatedAt");
