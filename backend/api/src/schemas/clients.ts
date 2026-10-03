import { z } from 'zod';
import { pagedResultSchema, uuidSchema } from './common.js';

/** `AddressDto` — the five address components stored across `domain.client`. */
export const addressSchema = z
  .object({
    country: z.string().nullish().describe('Country'),
    region: z.string().nullish().describe('Region, state or county'),
    city: z.string().nullish().describe('City'),
    street: z.string().nullish().describe('Street and number'),
    postalCode: z.string().nullish().describe('Postal code'),
  })
  .describe('Postal address');

/**
 * `ClientDto` / `LegalClientDto` / `PrivateClientDto`.
 *
 * The three .NET records share one base, so a single schema covers all of
 * them. Subtype-specific fields are null when they do not apply, which is
 * exactly what the original serialiser emitted — the positional record
 * properties were always present.
 */
export const clientSchema = z
  .object({
    id: uuidSchema,
    address: addressSchema.nullable(),
    phone: z.string().nullable(),
    emailAddresses: z.array(z.string()).nullable().describe('All known addresses'),
    currentEmail: z.string().nullable().describe('The single active address'),
    isAsshole: z.boolean().nullable().describe('Flagged as difficult'),
    ssAsshole: z
      .boolean()
      .nullable()
      .describe('Legacy duplicate of `isAsshole`, preserved for compatibility'),
    description: z.string().nullable(),
    introducedAt: z.string().nullable(),
    isPrivate: z.boolean().nullable().describe('True for individuals, false for companies'),
    name: z.string().nullish().describe('Company name. Legal clients only.'),
    regNr: z.string().nullish().describe('Company registration number. Legal clients only.'),
    firstName: z.string().nullish().describe('Given name. Private clients only.'),
    lastName: z.string().nullish().describe('Family name. Private clients only.'),
    personalCode: z.string().nullish().describe('Personal identification code. Private clients only.'),
  })
  .describe('A client');

const clientBodyShape = {
  address: addressSchema.nullish(),
  phone: z.string().nullish(),
  emailAddresses: z.array(z.string()).nullish().describe('Replaces the stored address list'),
  currentEmail: z
    .string()
    .nullish()
    .describe('Must be one of `emailAddresses`; becomes the active address'),
  isAsshole: z.boolean().nullish(),
  description: z.string().nullish(),
  introducedAt: z.string().nullish().describe('Defaults to now when omitted'),
};

/** Body of `POST /api/legalclients` and `PUT /api/legalclients/{id}`. */
export const legalClientBodySchema = z
  .object({
    id: uuidSchema.nullish(),
    name: z.string().min(1).describe('Company name'),
    regNr: z.string().min(1).describe('Company registration number'),
    ...clientBodyShape,
  })
  .describe('A legal client');

/** Body of `POST /api/privateclients` and `PUT /api/privateclients/{id}`. */
export const privateClientBodySchema = z
  .object({
    id: uuidSchema.nullish(),
    firstName: z.string().min(1).describe('Given name'),
    lastName: z.string().nullish(),
    personalCode: z.string().nullish(),
    ...clientBodyShape,
  })
  .describe('A private client');

/** `ClientPageDto` — row shape of `GET /api/clients/page`. */
export const clientPageItemSchema = z
  .object({
    id: uuidSchema,
    name: z.string().nullable().describe('Full name, or company name'),
    address: z.string().nullable().describe('Address components joined with spaces'),
    phone: z.string().nullable(),
    email: z.string().nullable().describe('The active email address'),
    introducedAt: z.string().nullable(),
    isCompany: z.boolean().nullable(),
  })
  .describe('A client, as shown in search results');

export const clientPageSchema = pagedResultSchema(clientPageItemSchema, 'A page of clients');
