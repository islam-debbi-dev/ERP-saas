import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Which deployment this is, for Sentry and logs (NODE_ENV is production on both). */
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  SENTRY_DSN: z.string().optional(),
  /** Git sha of the build, baked into the image; tags Sentry events and /health. */
  SENTRY_RELEASE: z.string().optional(),
  /** Requests per minute per IP, all routes; and for the auth routes (register, refresh…). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(30),
  /**
   * Path the API is served under by the reverse proxy (`/api` in production, where Caddy
   * strips it). The refresh cookie's path must include it for the browser to send it.
   */
  PUBLIC_PATH_PREFIX: z
    .string()
    .regex(/^(\/[\w-]+)*$/, 'PUBLIC_PATH_PREFIX looks like /api, or empty')
    .default(''),
  /** Chromium used to render PDFs; unset = the browser puppeteer downloaded. */
  CHROMIUM_PATH: z.string().min(1).optional(),
  /**
   * Set to `1` by Vercel in its functions. They have no Chromium: PDFs then use the
   * serverless build of @sparticuz/chromium (unless CHROMIUM_PATH is set).
   */
  VERCEL: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Parses process.env once at startup; the app refuses to boot with a bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
