import { z } from 'zod';
import { pagedResultSchema, uuidSchema } from './common.js';

/** `VehicleDto`. */
export const vehicleSchema = z
  .object({
    id: uuidSchema,
    producer: z.string().nullable().describe('Manufacturer'),
    model: z.string().nullable(),
    regNr: z.string().nullable().describe('Registration number'),
    vin: z.string().nullable(),
    odo: z.coerce.number().int().nullish().describe('Odometer reading in km'),
    body: z.string().nullable(),
    drivingSide: z.string().nullable(),
    engine: z.string().nullable(),
    productionDate: z.string().nullable(),
    region: z.string().nullable(),
    series: z.string().nullable(),
    transmission: z.string().nullable(),
    ownerId: uuidSchema.nullable().describe('Current owner'),
    ownerName: z.string().nullable(),
    description: z.string().nullable(),
    introducedAt: z.string().nullable(),
  })
  .describe('A vehicle');

/** Body of `POST /api/vehicles` and `PUT /api/vehicles/{id}`. */
export const vehicleBodySchema = z
  .object({
    id: uuidSchema.nullish(),
    producer: z.string().nullish(),
    model: z.string().nullish(),
    regNr: z.string().min(1).describe('Registration number. Required.'),
    vin: z.string().nullish(),
    odo: z.coerce.number().int().nullish().describe('Accepts a number or a numeric string'),
    body: z.string().nullish(),
    drivingSide: z.string().nullish(),
    engine: z.string().nullish(),
    productionDate: z.string().nullish(),
    region: z.string().nullish(),
    series: z.string().nullish(),
    transmission: z.string().nullish(),
    ownerId: uuidSchema.nullish().describe('Omit or send null to end the current registration'),
    description: z.string().nullish(),
    introducedAt: z.string().nullish(),
  })
  .describe('A vehicle');

/** `ClientVehicleDto` — a vehicle registered to a specific client. */
export const clientVehicleSchema = z
  .object({
    id: uuidSchema,
    ownerId: uuidSchema.nullable(),
    producer: z.string().nullable(),
    model: z.string().nullable(),
    regNr: z.string().nullable(),
    vin: z.string().nullable(),
  })
  .describe('A vehicle currently registered to a client');

/** `VehiclePageDto` — row shape of `GET /api/vehicles/page`. */
export const vehiclePageItemSchema = z
  .object({
    id: uuidSchema,
    producer: z.string().nullable(),
    model: z.string().nullable(),
    regNr: z.string().nullable(),
    vin: z.string().nullable(),
    body: z.string().nullable(),
    engine: z.string().nullable(),
    productionDate: z.string().nullable().describe('Formatted as MM-YYYY'),
    region: z.string().nullable(),
    series: z.string().nullable(),
    transmission: z.string().nullable(),
    ownerName: z.string().nullable(),
    ownerId: uuidSchema.nullable(),
  })
  .describe('A vehicle, as shown in search results');

export const vehiclePageSchema = pagedResultSchema(vehiclePageItemSchema, 'A page of vehicles');
