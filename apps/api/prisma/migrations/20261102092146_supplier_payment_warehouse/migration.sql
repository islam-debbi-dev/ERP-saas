-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "warehouseId" UUID;

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_warehouseId_paidAt_idx" ON "supplier_payments"("tenantId", "warehouseId", "paidAt");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
