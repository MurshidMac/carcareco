import { z } from 'zod';
import { uuidSchema } from './common.js';

/** DTOs for the auth and profile endpoints, ported from the .NET contracts. */

/** `LoginDto`. */
export const loginSchema = z.object({
  username: z.string().min(1).describe('Username'),
  password: z.string().min(1).describe('Password'),
  serverSecret: z
    .string()
    .min(1)
    .describe('Shared secret configured as JWT_CONSUMER_SECRET on the API and SERVER_SECRET in the frontend'),
});

/** Response of `POST /api/users/authenticate`. */
export const authenticateResponseSchema = z
  .object({
    jwt: z.string().describe('Privileged token carrying the Root role. Used by the server components.'),
    publicJwt: z.string().describe('Role-less token. Handed to the browser.'),
    timeout: z.number().int().describe('Session lifetime in seconds'),
  })
  .describe('Authentication result');

/** `UserProfileDto`. */
export const userProfileSchema = z
  .object({
    firstName: z.string().nullable().describe('Given name'),
    lastName: z.string().nullable().describe('Family name'),
    email: z.string().nullable().describe('Email address'),
    userName: z.string().nullable().describe('Login name'),
    profileImageBase64: z
      .string()
      .nullable()
      .describe('Profile picture, raw base64 without a data-URL prefix'),
  })
  .describe('The signed-in user profile');

/** `UserProfileUpdateDto`. */
export const putProfileSchema = z.object({
  firstName: z.string().nullish().describe('Given name'),
  lastName: z.string().nullish().describe('Family name'),
  email: z.string().nullish().describe('Email address'),
  userName: z.string().nullish().describe('Login name'),
  profileImageBase64: z
    .string()
    .nullish()
    .describe('Raw base64 encoded image. Strip the `data:image/...;base64,` prefix client-side.'),
});

/** `PasswordChangeDto`. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).describe('The password currently in use'),
  newPassword: z.string().min(1).describe('The replacement password'),
  confirmPassword: z.string().min(1).describe('Must equal newPassword'),
});

/** `CreateDemoDto` / `DemoSetupDto`. */
export const demoSetupSchema = z.object({
  companyName: z
    .string()
    .nullish()
    .describe('Optional company name, used for the requisites of the new tenant'),
});

export const demoSetupResponseSchema = z
  .object({
    username: z.string().describe('Username of the seeded administrator'),
    password: z.string().describe('Password of the seeded administrator'),
    tenantName: z.string().describe('Generated tenant identifier, also the database suffix'),
  })
  .describe('Demo tenant credentials');

export const idParamSchema = z.object({ id: uuidSchema });