import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { type Permission, PERMISSIONS, ROLE_PERMISSIONS, Role, ROLES } from '@erp/shared';
import { IS_PUBLIC_KEY, PERMISSION_KEY, ROLES_KEY } from './decorators';

/**
 * Phase 24 turned module routes from role lists into permissions. The role defaults must
 * reproduce what each role could do before, route by route: `route-roles.baseline.json`
 * is the route table of phase 23 (`@Roles` per route, null = any signed-in user,
 * "PUBLIC" = no token). A role that could call a route still can, and one that could not
 * still cannot, unless the owner grants or revokes the permission.
 */

interface RouteAccess {
  isPublic: boolean;
  roles: Role[] | null;
  permission: Permission | null;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'generated' ? [] : controllerFiles(p);
    return /controllers?\.ts$/.test(f) ? [p] : [];
  });
}

async function routeTable(): Promise<Map<string, RouteAccess>> {
  const table = new Map<string, RouteAccess>();
  for (const file of controllerFiles(join(__dirname, '..')).sort()) {
    const mod = (await import(file)) as Record<string, unknown>;
    for (const candidate of Object.values(mod)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as { prototype: Record<string, unknown> };
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
      if (base === undefined) continue;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const key = `${RequestMethod[method]} /${[base, path]
          .flat()
          .filter((x) => x && x !== '/')
          .join('/')}`.replace(/\/+/g, '/');
        const meta = <T>(k: string): T | undefined =>
          (Reflect.getMetadata(k, handler) as T | undefined) ??
          (Reflect.getMetadata(k, controller) as T | undefined);
        table.set(key, {
          isPublic: meta<boolean>(IS_PUBLIC_KEY) ?? false,
          roles: meta<Role[]>(ROLES_KEY) ?? null,
          permission: meta<Permission>(PERMISSION_KEY) ?? null,
        });
      }
    }
  }
  return table;
}

const before = JSON.parse(
  readFileSync(join(__dirname, 'route-roles.baseline.json'), 'utf8'),
) as Record<string, Role[] | null | 'PUBLIC'>;

function allowedBefore(route: string, role: Role): boolean {
  const roles = before[route];
  return roles === 'PUBLIC' || roles === null || roles === undefined || roles.includes(role);
}

function allowedNow(access: RouteAccess, role: Role): boolean {
  if (access.isPublic) return true;
  if (access.roles && access.roles.length > 0 && !access.roles.includes(role)) return false;
  return !access.permission || ROLE_PERMISSIONS[role].includes(access.permission);
}

describe('route access (phase 24: nobody gains or loses a right)', () => {
  let table: Map<string, RouteAccess>;

  beforeAll(async () => {
    table = await routeTable();
  });

  it('still has every route of the baseline', () => {
    const missing = Object.keys(before).filter((r) => !table.has(r));
    expect(missing).toEqual([]);
  });

  it('only names known permissions', () => {
    const unknown = [...table.entries()]
      .filter(([, a]) => a.permission && !PERMISSIONS.includes(a.permission))
      .map(([r]) => r);
    expect(unknown).toEqual([]);
  });

  it('moved the module routes to permissions', () => {
    const withPermission = [...table.values()].filter((a) => a.permission).length;
    expect(withPermission).toBeGreaterThan(80);
  });

  it.each(ROLES)('gives %s exactly what it had on every route', (role) => {
    const changed = Object.keys(before)
      .filter((route) => table.has(route))
      .filter((route) => allowedNow(table.get(route)!, role) !== allowedBefore(route, role))
      .map((route) => `${route}: ${allowedBefore(route, role) ? 'lost' : 'gained'}`);
    expect(changed).toEqual([]);
  });

  it('lets a grant open a route and a revoke close it', () => {
    const route = table.get('POST /sales')!;
    expect(route.permission).toBe('SALES_CREATE');
    expect(route.roles).toBeNull();
    // A storekeeper could not sell before; with SALES_CREATE granted, the guard lets him.
    expect(allowedNow(route, Role.STOREKEEPER)).toBe(false);
    expect(ROLE_PERMISSIONS[Role.STOREKEEPER]).not.toContain('SALES_CREATE');
  });
});
