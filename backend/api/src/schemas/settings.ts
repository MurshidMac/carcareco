import { z } from 'zod';
import {
  errorResponseSchema,
  notFoundResponse,
  pagedResultSchema,
  unauthorizedResponse,
  uuidSchema,
} from './common.js';

/* ─── Tenant settings (tenant_config schema) ──────────────────────────────── */

/** `RequisitesOptions`. */
export const requisitesSchema = z
  .object({
    name: z.string().nullable().describe('Registered company name'),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    email: z.string().nullable(),
    bankAccount: z.string().nullable(),
    regNr: z.string().nullable(),
    kmkr: z.string().nullable().describe('KMKR — Estonian payroll registration code'),
  })
  .describe('Company requisites printed on invoices and estimates');

/** `InvoiceOptions`. */
export const invoiceOptionsSchema = z
  .object({
    vatRate: z.number().int().describe('Value added tax rate, e.g. 22'),
    surCharge: z.string().nullable(),
    disclaimer: z.string().nullable(),
    signatureLine: z.boolean(),
    emailContent: z.string().nullable().describe('Body of the invoice email'),
  })
  .describe('Invoice defaults');

/** `EstimateOptions`. */
export const estimateOptionsSchema = z
  .object({ emailContent: z.string().nullable().describe('Body of the estimate email') })
  .describe('Estimate defaults');

/** `PricingOptions`. */
export const pricingOptionsSchema = z
  .object({ invoice: invoiceOptionsSchema, estimate: estimateOptionsSchema })
  .describe('Pricing defaults');

/** `AppOptions`. */
export const appOptionsSchema = z
  .object({ requisites: requisitesSchema, pricing: pricingOptionsSchema })
  .describe('Tenant configuration');

/* ─── System search ───────────────────────────────────────────────────────── */

/** Row of `GET /api/query/{searchText}`. */
export const globalSearchHitSchema = z
  .object({
    id: uuidSchema,
    resourcename: z.string().nullable().describe('`Client`, `Vehicle`, `Work nr. `, …'),
    name: z.string().nullable(),
    controller: z
      .string()
      .nullable()
      .describe('Legacy routing key, e.g. `klient`, `soiduk`, `too`, `varuosa`, `tootaja`'),
  })
  .describe('A global search hit');

export const globalSearchResultSchema = pagedResultSchema(
  globalSearchHitSchema,
  'Global search results',
);

/* ─── Demo provisioning ───────────────────────────────────────────────────── */

/** `DemoSetupRequest`. */
export const demoSetupRequestSchema = z
  .object({ companyName: z.string().nullish().describe('Company name for the demo tenant') })
  .describe('Demo provisioning request');

/** `DemoSetupResponse`. */
export const demoSetupResponseSchema = z
  .object({
    username: z.string().describe('Generated login'),
    password: z.string().describe('Generated password'),
  })
  .describe('Demo tenant credentials');

/* ─── Health ──────────────────────────────────────────────────────────────── */

export const healthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']).describe('Overall health'),
    database: z.enum(['up', 'down']).describe('Database reachability'),
    multiTenancy: z.boolean(),
    version: z.string(),
    uptimeSeconds: z.number(),
  })
  .describe('Service health');

export const dbDumpSchema = z
  .object({
    filename: z.string(),
    contentType: z.string(),
  })
  .describe('Database export metadata');

export const okSchema = z.object({ ok: z.boolean() }).describe('Acknowledgement');

/** Re-exported from `common` so every route describes errors the same way. */
export { notFoundResponse, unauthorizedResponse, errorResponseSchema };
