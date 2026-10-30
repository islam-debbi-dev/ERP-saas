-- CreateEnum
CREATE TYPE "GeoCheckMode" AS ENUM ('OFF', 'FLAG', 'BLOCK');

-- CreateEnum
CREATE TYPE "GeoStatus" AS ENUM ('NO_SIGNAL', 'MOCKED', 'LOW_ACCURACY', 'NO_CLIENT_GPS', 'OK', 'FAR');

-- CreateEnum
CREATE TYPE "GeoRefType" AS ENUM ('SALE', 'PAYMENT', 'VISIT');

-- CreateEnum
CREATE TYPE "GeoReviewStatus" AS ENUM ('NONE', 'JUSTIFIED', 'NOT_JUSTIFIED');

-- CreateEnum
CREATE TYPE "GeoChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "geoAccuracyM" INTEGER,
ADD COLUMN     "geoSetAt" TIMESTAMPTZ(3),
ADD COLUMN     "geoSetBy" UUID,
ADD COLUMN     "lat" DECIMAL(9,6),
ADD COLUMN     "lng" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "geoCheckMode" "GeoCheckMode" NOT NULL DEFAULT 'FLAG',
ADD COLUMN     "geoMaxAccuracyM" SMALLINT NOT NULL DEFAULT 200,
ADD COLUMN     "geoRadiusM" SMALLINT NOT NULL DEFAULT 150;

-- CreateTable
CREATE TABLE "geo_checks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "refType" "GeoRefType" NOT NULL,
    "refId" UUID NOT NULL,
    "refNumber" VARCHAR(20),
    "clientId" UUID,
    "userId" UUID,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "accuracyM" INTEGER,
    "isMocked" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientLat" DECIMAL(9,6),
    "clientLng" DECIMAL(9,6),
    "distanceM" INTEGER,
    "status" "GeoStatus" NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" VARCHAR(255),
    "reviewStatus" "GeoReviewStatus" NOT NULL DEFAULT 'NONE',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "geo_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_check_reviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "geoCheckId" UUID NOT NULL,
    "verdict" "GeoReviewStatus" NOT NULL,
    "note" VARCHAR(255),
    "reviewedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_check_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_geo_change_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "accuracyM" INTEGER,
    "previousLat" DECIMAL(9,6),
    "previousLng" DECIMAL(9,6),
    "note" VARCHAR(255),
    "status" "GeoChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" UUID NOT NULL,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "rejectReason" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_geo_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_checks_tenantId_receivedAt_idx" ON "geo_checks"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "geo_checks_tenantId_userId_receivedAt_idx" ON "geo_checks"("tenantId", "userId", "receivedAt");

-- CreateIndex
CREATE INDEX "geo_checks_tenantId_status_reviewStatus_idx" ON "geo_checks"("tenantId", "status", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "geo_checks_tenantId_refType_refId_key" ON "geo_checks"("tenantId", "refType", "refId");

-- CreateIndex
CREATE INDEX "geo_check_reviews_tenantId_geoCheckId_createdAt_idx" ON "geo_check_reviews"("tenantId", "geoCheckId", "createdAt");

-- CreateIndex
CREATE INDEX "client_geo_change_requests_tenantId_status_createdAt_idx" ON "client_geo_change_requests"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "client_geo_change_requests_tenantId_clientId_createdAt_idx" ON "client_geo_change_requests"("tenantId", "clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "geo_checks" ADD CONSTRAINT "geo_checks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_checks" ADD CONSTRAINT "geo_checks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_check_reviews" ADD CONSTRAINT "geo_check_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_check_reviews" ADD CONSTRAINT "geo_check_reviews_geoCheckId_fkey" FOREIGN KEY ("geoCheckId") REFERENCES "geo_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_geo_change_requests" ADD CONSTRAINT "client_geo_change_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_geo_change_requests" ADD CONSTRAINT "client_geo_change_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: reviews are append-only (AGENTS.md rules 1 and 7), even for raw SQL.
CREATE FUNCTION "geo_check_reviews_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'geo_check_reviews is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "geo_check_reviews_no_update_delete"
  BEFORE UPDATE OR DELETE ON "geo_check_reviews"
  FOR EACH ROW EXECUTE FUNCTION "geo_check_reviews_append_only"();

-- Hand-written: settings stay in a sane range whatever writes them.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_geo_settings_check"
  CHECK ("geoRadiusM" > 0 AND "geoMaxAccuracyM" > 0);
