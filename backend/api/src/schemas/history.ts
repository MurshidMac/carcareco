import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Shapes for the maintenance-history feature (`GET /api/vehicles/{id}/history`,
 * `GET /api/clients/{id}/history`) and the home dashboard (`GET /api/dashboard`).
 *
 * None of these existed in the .NET backend; they are additive, so the shapes
 * are defined fresh rather than ported.
 */

const nullableString = z.string().nullable();

export const historyActivitySchema = z
  .object({
    id: uuidSchema,
    orderNr: z.coerce.number().int(),
    name: z.enum(['offer', 'repairjob']),
    startedOn: z.string(),
    startedBy: nullableString,
    notes: nullableString,
  })
  .describe('An offer or repair job on a work order');

export const historyOfferSchema = z
  .object({
    id: uuidSchema,
    orderNr: z.coerce.number().int(),
    number: nullableString,
    issuedOn: nullableString,
    sentOn: nullableString,
    acceptedOn: nullableString,
    totalWithVat: z.number(),
  })
  .describe('An estimate issued on an offer, including the accepted amount');

export const historyInvoiceSchema = z
  .object({
    id: uuidSchema,
    number: z.coerce.number().int().nullable(),
    issuedOn: nullableString,
    sentOn: nullableString,
    paid: z.boolean(),
    dueDays: z.coerce.number().int(),
    totalWithVat: z.number(),
  })
  .describe('The invoice of the work order, if one was issued');

export const historyWorkSchema = z
  .object({
    id: uuidSchema,
    workNr: z.string(),
    startedOn: z.string(),
    completedOn: nullableString,
    status: z.string(),
    userStatus: nullableString,
    notes: nullableString,
    odo: z.coerce.number().int().nullable(),
    /** Registration number of the vehicle — set on client history entries. */
    regNr: nullableString,
    vehicleId: uuidSchema.nullable(),
    clientId: uuidSchema.nullable(),
    clientName: nullableString,
    mechanicNames: nullableString,
    activities: z.array(historyActivitySchema),
    offers: z.array(historyOfferSchema),
    invoices: z.array(historyInvoiceSchema),
  })
  .describe('One work order in a history timeline');

export const vehicleHistorySchema = z.object({
  vehicle: z
    .object({
      id: uuidSchema,
      regNr: z.string(),
      producer: nullableString,
      model: nullableString,
      vin: nullableString,
      odo: z.coerce.number().int().nullable(),
    })
    .describe('The vehicle whose history is shown'),
  client: z
    .object({
      id: uuidSchema.nullable(),
      name: nullableString,
    })
    .describe('The current owner'),
  workOrders: z.array(historyWorkSchema),
});

export const clientHistorySchema = z.object({
  client: z
    .object({
      id: uuidSchema,
      name: nullableString,
      isPrivate: z.boolean(),
      phone: nullableString,
      email: nullableString,
      regNr: nullableString,
    })
    .describe('The client whose history is shown'),
  vehicles: z
    .array(
      z.object({
        id: uuidSchema,
        regNr: z.string(),
        producer: nullableString,
        model: nullableString,
        vin: nullableString,
      }),
    )
    .describe('Vehicles currently registered to the client'),
  workOrders: z.array(historyWorkSchema),
});

/** A single work order as shown on the dashboard's recent list. */
export const dashboardWorkSchema = z
  .object({
    id: uuidSchema,
    workNr: z.string(),
    startedOn: z.string(),
    status: z.string(),
    clientName: nullableString,
    regNr: nullableString,
    mechanicNames: nullableString,
    notes: nullableString,
    odo: z.coerce.number().int().nullable(),
  })
  .describe('A recent work order');

export const dashboardSchema = z.object({
  counts: z
    .object({
      work: z.coerce.number().int(),
      openWork: z.coerce.number().int(),
      clients: z.coerce.number().int(),
      vehicles: z.coerce.number().int(),
      spareParts: z.coerce.number().int(),
      storages: z.coerce.number().int(),
    })
    .describe('Row counts across the main sections'),
  recentWork: z.array(dashboardWorkSchema).describe('The most recently started work orders'),
});