import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_SCOPED_MODELS } from './tenant-extension';

/**
 * Models with a tenantId column that the extension does not scope. RLS still isolates
 * them in production, but a database role that bypasses RLS (a local superuser) would
 * read across companies. Shrink this list; never grow it.
 */
const NOT_SCOPED = new Set<string>([
  // Platform journal: written by the super-admin, tenantId is optional.
  'PlatformAuditLog',
  // Phase 22, not scoped yet (found in phase 25): reads rely on RLS alone.
  'ImportFile',
  'ImportCost',
  'ImportCostAllocation',
]);

describe('tenant extension', () => {
  it('scopes every model that has a tenantId column', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const withTenant = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+tenantId\s/m.test(body!))
      .map(([, name]) => name!);
    const missing = withTenant.filter((m) => !TENANT_SCOPED_MODELS.has(m) && !NOT_SCOPED.has(m));
    expect(missing).toEqual([]);
    // The exceptions must still exist, so a fixed one leaves the list.
    expect([...NOT_SCOPED].filter((m) => TENANT_SCOPED_MODELS.has(m))).toEqual([]);
  });
});
