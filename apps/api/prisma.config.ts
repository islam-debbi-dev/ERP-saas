import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations run as the owner (DATABASE_URL_MIGRATE); the API itself connects as the
    // RLS-bound erp_app (DATABASE_URL). Falls back to a placeholder so `prisma generate`
    // works without a .env (CI build).
    url:
      process.env['DATABASE_URL_MIGRATE'] ??
      process.env['DATABASE_URL'] ??
      'postgresql://placeholder:5432/placeholder',
  },
});
