import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

loadDotenv({ path: path.join(projectRoot, '.env') });
loadDotenv({ path: path.join(projectRoot, '..', 'Carmasters.Http.Api', 'appsettings.Secrets.json.example') });

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int());

/**
 * Shape mirrors the .NET `DbOptions` record so existing appsettings-style
 * configuration can be translated 1:1. `suffix` values are configuration
 * driven (never hardcoded) — see MultiTenancyDbName in the original backend.
 */
const dbSchema = z.object({
  host: z.string().min(1),
  port: int(5432),
  user: z.string().min(1),
  password: z.string(),
  name: z.string().min(1),
  multiTenancy: z.object({
    enabled: bool(false),
    suffix: z.object({
      tenancy: z.string().min(1).default('tenancy'),
      template: z.string().min(1).default('template'),
    }),
  }),
});

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(15567),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DOCS_PATH: z.string().default('/docs'),
  OPENAPI_PATH: z.string().default('/docs/openapi.json'),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: int(5432),
  DB_USER: z.string().default('carcare'),
  DB_PASSWORD: z.string().default('carcare'),
  DB_NAME: z.string().default('carcare'),
  DB_MULTITENANCY_ENABLED: bool(false),
  DB_MULTITENANCY_SUFFIX_TENANCY: z.string().default('tenancy'),
  DB_MULTITENANCY_SUFFIX_TEMPLATE: z.string().default('template'),

  JWT_SECRET: z.string().default(''),
  JWT_SESSION_TIMEOUT: int(28_800),
  JWT_CONSUMER_SECRET: z.string().default(''),

  CORS_MODE: z.enum(['open', 'restricted']).default('open'),
  CORS_APP_HOST: z.string().default('localhost'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: int(465),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_SECURE: bool(true),
  MAIL_FROM_ADDRESS: z.string().default('no-reply@carcare.local'),
  MAIL_FROM_NAME: z.string().default('CarCare'),

  PDF_DIRECTORY: z.string().default('./pdf'),
  PLAYWRIGHT_CHROMIUM_PATH: z.string().default(''),

  RATE_LIMIT_TENANT_MAX: int(300),
  RATE_LIMIT_TENANT_WINDOW_SECONDS: int(300),
  RATE_LIMIT_LOGIN_MAX: int(10),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: int(60),
  RATE_LIMIT_PICTURE_MAX: int(60),
  RATE_LIMIT_PICTURE_WINDOW_SECONDS: int(60),
  RATE_LIMIT_DEMO_MAX: int(1),
  RATE_LIMIT_DEMO_WINDOW_SECONDS: int(86_400),

  LOGIN_FAILURE_DELAY_MS: int(3000),
  MAX_PROFILE_IMAGE_BYTES: int(5 * 1024 * 1024),
});

const raw = envSchema.safeParse(process.env);
if (!raw.success) {
  const issues = raw.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const e = raw.data;

const db = dbSchema.parse({
  host: e.DB_HOST,
  port: e.DB_PORT,
  user: e.DB_USER,
  password: e.DB_PASSWORD,
  name: e.DB_NAME,
  multiTenancy: {
    enabled: e.DB_MULTITENANCY_ENABLED,
    suffix: {
      tenancy: e.DB_MULTITENANCY_SUFFIX_TENANCY,
      template: e.DB_MULTITENANCY_SUFFIX_TEMPLATE,
    },
  },
});

const isProduction = e.NODE_ENV === 'production';

if (!e.JWT_SECRET) {
  if (isProduction) {
    throw new Error('JWT_SECRET is required in production. Generate one with: openssl rand -hex 64');
  }
  // Deterministic development-only fallback so the API boots out of the box.
  e.JWT_SECRET = 'insecure-development-only-secret-do-not-use-in-production';
}

if (e.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

export const config = {
  env: e.NODE_ENV,
  isProduction,
  host: e.HOST,
  port: e.PORT,
  logLevel: e.LOG_LEVEL,
  projectRoot,

  docs: {
    path: e.DOCS_PATH,
    openapiPath: e.OPENAPI_PATH,
  },

  db,

  jwt: {
    secret: e.JWT_SECRET,
    consumerSecret: e.JWT_CONSUMER_SECRET,
    /** Seconds. Mirrors .NET `JwtOptions.SessionTimeout`. */
    sessionTimeoutSeconds: e.JWT_SESSION_TIMEOUT,
  },

  cors: {
    mode: e.CORS_MODE,
    appHost: e.CORS_APP_HOST,
  },

  smtp: {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    user: e.SMTP_USER,
    password: e.SMTP_PASSWORD,
    secure: e.SMTP_SECURE,
    fromAddress: e.MAIL_FROM_ADDRESS,
    fromName: e.MAIL_FROM_NAME,
  },

  pdf: {
    directory: path.isAbsolute(e.PDF_DIRECTORY)
      ? e.PDF_DIRECTORY
      : path.join(projectRoot, e.PDF_DIRECTORY),
    chromiumPath: e.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  },

  rateLimit: {
    tenant: { max: e.RATE_LIMIT_TENANT_MAX, windowSeconds: e.RATE_LIMIT_TENANT_WINDOW_SECONDS },
    login: { max: e.RATE_LIMIT_LOGIN_MAX, windowSeconds: e.RATE_LIMIT_LOGIN_WINDOW_SECONDS },
    picture: { max: e.RATE_LIMIT_PICTURE_MAX, windowSeconds: e.RATE_LIMIT_PICTURE_WINDOW_SECONDS },
    demo: { max: e.RATE_LIMIT_DEMO_MAX, windowSeconds: e.RATE_LIMIT_DEMO_WINDOW_SECONDS },
  },

  loginFailureDelayMs: e.LOGIN_FAILURE_DELAY_MS,
  maxProfileImageBytes: e.MAX_PROFILE_IMAGE_BYTES,
} as const;

export type AppConfig = typeof config;
