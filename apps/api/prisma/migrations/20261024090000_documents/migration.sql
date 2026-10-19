-- CreateEnum
CREATE TYPE "PrintFormat" AS ENUM ('A4', 'A5');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "defaultPrintFormat" "PrintFormat" NOT NULL DEFAULT 'A4',
ADD COLUMN     "documentFooter" VARCHAR(500),
ADD COLUMN     "timbreTranches" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tvaMention" VARCHAR(120) NOT NULL DEFAULT 'Non assujetti à la TVA';

-- CreateTable
CREATE TABLE "document_prints" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "docType" "DocType" NOT NULL,
    "docId" UUID NOT NULL,
    "format" "PrintFormat" NOT NULL,
    "printedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_prints_seq_key" ON "document_prints"("seq");

-- CreateIndex
CREATE INDEX "document_prints_tenantId_docType_docId_seq_idx" ON "document_prints"("tenantId", "docType", "docId", "seq");

-- AddForeignKey
ALTER TABLE "document_prints" ADD CONSTRAINT "document_prints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: the print log is append-only (it decides original vs DUPLICATA).
CREATE FUNCTION "document_prints_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document_prints is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_prints_no_update_delete"
  BEFORE UPDATE OR DELETE ON "document_prints"
  FOR EACH ROW EXECUTE FUNCTION "document_prints_append_only"();

-- Data: a single-rate rule set before phase 8 becomes one open-ended tranche.
-- "timbreRate" is kept (expand step) and dropped in a later release.
UPDATE "tenants"
SET "timbreTranches" = jsonb_build_array(
  jsonb_build_object('upTo', NULL, 'rate', "timbreRate"::text)
)
WHERE "timbreRate" IS NOT NULL;
