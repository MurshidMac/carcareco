import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { limits } from '../core/rate-limit.js';
import { requirePrincipal, requireRootPrincipal } from '../plugins/context.js';
import { pageQuerySchema, standardResponses } from '../schemas/common.js';
import {
  employeeBodySchema,
  employeePageSchema,
  employeeSchema,
  mechanicSchema,
} from '../schemas/employees.js';
import { EmployeeRepository } from '../db/repositories/employees.js';
import { registerCrud } from './crud.js';

/**
 * Port of `EmployeesController`.
 *
 * `ServerSidePolicy` sat on the class, so every action needed the Root role —
 * including the mechanic dropdown.
 *
 * `AfterSaved` created a login as a side effect of saving an employee: when the
 * body carried a `userName`, a password was mandatory and the name had to be
 * free. That ran on POST only — `AfterUpdated` was empty — so editing an
 * employee never changed their credentials.
 */
export const employeeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** `EmployeeRepository` needs both the tenant database and the central user list. */
  const repoFor = (request: FastifyRequest): EmployeeRepository =>
    new EmployeeRepository(request.tenantDb(), request.userListDb(), request.principal?.tenantName ?? '');

  app.get(
    '/employees',
    {
      schema: {
        tags: ['Employees'],
        summary: 'List employees',
        description: 'Returns the id and display name of every employee, for dropdowns.',
        response: standardResponses(mechanicSchema, 'Employees'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return repoFor(request).listMechanics();
    },
  );

  app.get(
    '/employees/page',
    {
      schema: {
        tags: ['Employees'],
        summary: 'Search employees',
        querystring: pageQuerySchema,
        response: standardResponses(employeePageSchema, 'A page of employees'),
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requirePrincipal(request);
      return repoFor(request).page(request.query);
    },
  );

  registerCrud(app, {
    path: '/employees',
    tags: ['Employees'],
    label: 'an employee',
    bodySchema: employeeBodySchema,
    recordSchema: employeeSchema,
    requireRoot: {},
    handlers: {
      find: async (request, id) => repoFor(request).findOrFail(id),
      create: async (request, body) => {
        const repo = repoFor(request);
        const id = await repo.create(body);

        if (body.userName?.trim()) {
          await repo.createLoginFor(id, body.userName.trim(), body.password ?? '', body.email ?? null);
        }
        return id;
      },
      update: async (request, id, body) => repoFor(request).update(id, body),
      remove: async (request, ids) => repoFor(request).delete(ids),
    },
  });
};
