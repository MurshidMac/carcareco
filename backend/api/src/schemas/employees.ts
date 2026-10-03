import { z } from 'zod';
import { pagedResultSchema, uuidSchema } from './common.js';

/**
 * `EmployeeDto`.
 *
 * `userName` and `password` exist only when the employee also has a login;
 * `password` is write-only and is never returned.
 */
export const employeeSchema = z
  .object({
    id: uuidSchema,
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    proffession: z.string().nullable().describe('Job title. Note the original spelling.'),
    description: z.string().nullable(),
    introducedAt: z.string().nullable(),
    userName: z.string().nullish().describe('Login name, when the employee has an account'),
    password: z
      .string()
      .nullish()
      .describe('Write-only. Required when creating an account for a new employee.'),
  })
  .describe('An employee');

/** Body of `POST /api/employees` and `PUT /api/employees/{id}`. */
export const employeeBodySchema = employeeSchema.partial().describe('An employee');

/** `{id, name}` projection returned by `GET /api/employees`. */
export const mechanicSchema = z
  .object({ id: uuidSchema, name: z.string().nullable() })
  .describe('A mechanic');

export const employeePageSchema = pagedResultSchema(employeeSchema, 'A page of employees');
