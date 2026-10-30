-- Row-Level Security for the phase 17 tables, which shipped without it. Same policy as
-- 20261028090000_row_level_security (and 20261029214213_warehouses_expand).
ALTER TABLE "geo_checks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "geo_checks"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "geo_check_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "geo_check_reviews"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "client_geo_change_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "client_geo_change_requests"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.rls_bypass', true) = 'on');
