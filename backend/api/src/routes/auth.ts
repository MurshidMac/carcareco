import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { config } from '../config/index.js';
import { generateToken, verifyToken } from '../core/auth/jwt.js';
import { hashPassword, verifyPassword } from '../core/auth/password.js';
import { limits } from '../core/rate-limit.js';
import { UserError, UnauthorizedError, NotFoundError } from '../core/errors.js';
import { requireRootPrincipal } from '../plugins/context.js';
import { UserRepository, decodeProfileImage } from '../db/repositories/users.js';
import { DemoSetupService } from '../db/repositories/tenancy.js';
import { dbFor } from '../db/pool.js';
import { domainDatabaseName } from '../core/tenancy.js';
import {
  authenticateResponseSchema,
  changePasswordSchema,
  demoSetupResponseSchema,
  demoSetupSchema,
  loginSchema,
  putProfileSchema,
  userProfileSchema,
} from '../schemas/auth.js';
import {
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  rateLimitedResponse,
  unauthorizedResponse,
  validationErrorResponse,
  okResponseSchema,
} from '../schemas/common.js';

const BEARER = [{ bearerAuth: [] }] as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveFullName(
  request: FastifyRequest,
  tenantName: string,
  employeeId: string,
): Promise<string> {
  if (!employeeId) return '';

  const result = await sql<{ fullName: string | null }>`
    select concat_ws(' ', firstname, lastname) as "fullName"
      from domain.employee
     where id = ${employeeId}::uuid
  `.execute(dbFor(domainDatabaseName(tenantName)));

  return result.rows[0]?.fullName ?? '';
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  /* ====================================================================== */
  /* POST /api/users/authenticate                                            */
  /* ====================================================================== */
  app.post(
    '/users/authenticate',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Authenticate',
        description: [
          'Exchanges a username, password and the shared server secret for a pair of tokens.',
          '',
          '- `jwt` carries `role: Root` and is intended for the Next.js server components.',
          '- `publicJwt` carries no role and is the only token exposed to the browser.',
          '',
          'Both tokens carry the tenant name (`spn`) and employee id (`userdata`) claims; the',
          'tenant determines which database the request is served from.',
          '',
          'Failed attempts respond `401` after a short delay to slow credential stuffing.',
        ].join('\n'),
        security: [],
        body: loginSchema,
        response: {
          200: authenticateResponseSchema,
          401: unauthorizedResponse[401],
          429: rateLimitedResponse[429],
        },
      },
      preHandler: limits.login(),
    },
    async (request, reply) => {
      const { username, password, serverSecret } = request.body;

      if (config.jwt.consumerSecret !== serverSecret) {
        await sleep(config.loginFailureDelayMs);
        throw new UnauthorizedError();
      }

      const users = new UserRepository(request.userListDb());
      const user = await users.getByUserName(username);

      if (!user || !(await verifyPassword(password, user.password))) {
        request.log.info({ username }, 'authentication failure');
        await sleep(config.loginFailureDelayMs);
        throw new UnauthorizedError();
      }

      const employeeId = user.employeeId ?? '';
      const tokenInput = {
        userName: user.userName,
        fullName: await resolveFullName(request, user.tenantName, employeeId),
        tenantName: user.tenantName,
        employeeId,
      };

      return reply.send({
        jwt: await generateToken({ ...tokenInput, publicUse: false }),
        publicJwt: await generateToken({ ...tokenInput, publicUse: true }),
        timeout: config.jwt.sessionTimeoutSeconds,
      });
    },
  );

  /* ====================================================================== */
  /* POST /api/demo/setup                                                   */
  /* ====================================================================== */
  app.post(
    '/demo/setup',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Create a demo tenant',
        description: [
          'Provisions a new tenant by cloning the template database, seeds sample clients and',
          'storage, and returns the credentials of a seeded administrator.',
          '',
          'Requires multi-tenancy to be enabled; otherwise responds `400`. Rate limited to one',
          'call per day per IP.',
        ].join('\n'),
        security: [],
        body: demoSetupSchema,
        response: {
          200: demoSetupResponseSchema,
          400: validationErrorResponse[400],
          429: rateLimitedResponse[429],
          500: internalErrorResponse[500],
        },
      },
      preHandler: limits.demo(),
    },
    async (request, reply) => {
      const body = request.body;
      const credentials = await new DemoSetupService().createDemoTenant(body.companyName);
      return reply.send(credentials);
    },
  );

  app.get(
    '/users/profilepicture/:jwt',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Download a profile picture',
        description: [
          'Returns the profile image of the user identified by the token in the path.',
          '',
          'Anonymous: the token in the path is the credential. Always responds `image/jpeg`; an',
          'unknown or invalid token yields a zero-byte image rather than an error, because the',
          'frontend renders this from an `<img>` tag.',
        ].join('\n'),
        security: [],
        params: z.object({ jwt: z.string().describe('The public JWT') }),
        response: {
          200: {
            description: 'JPEG image, possibly zero-length',
            // The serializer compiler only accepts Zod schemas, so the binary
            // payload is described as a Buffer rather than a JSON schema.
            content: { 'image/jpeg': { schema: z.instanceof(Buffer) } },
          },
        },
      },
      preHandler: limits.profilePicture(),
    },
    async (request, reply) => {
      const empty = (): ReturnType<typeof reply.send> =>
        reply.header('Content-Type', 'image/jpeg').send(Buffer.alloc(0));

      let tenantName: string;
      let employeeId: string;
      try {
        const params = request.params;
        const principal = await verifyToken(params.jwt);
        tenantName = principal.tenantName;
        employeeId = principal.employeeId;
      } catch (error) {
        request.log.warn({ err: error }, 'cannot resolve user picture: invalid token');
        return empty();
      }

      try {
        const user = await new UserRepository(request.userListDb()).getByIdentifier(
          tenantName,
          employeeId,
        );
        if (!user?.profileImage) return empty();
        return reply.header('Content-Type', 'image/jpeg').send(user.profileImage);
      } catch (error) {
        request.log.error({ err: error }, 'cannot resolve user picture');
        return empty();
      }
    },
  );

  /* ====================================================================== */
  /* POST /api/users/extendsession                                          */
  /* ====================================================================== */
  app.post(
    '/users/extendsession',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Extend the session',
        description:
          'Issues a fresh token for the calling user, resetting the inactivity window. Responds with the raw JWT as plain text. Requires the privileged token.',
        security: BEARER,
        body: z.object({}).loose(),
        response: {
          200: {
            description: 'A newly issued JWT',
            content: { 'text/plain': { schema: z.string() } },
          },
          401: unauthorizedResponse[401],
          403: forbiddenResponse[403],
        },
      },
    },
    async (request, reply) => {
      const principal = requireRootPrincipal(request);
      const jwt = await generateToken({
        userName: principal.userName,
        fullName: await resolveFullName(request, principal.tenantName, principal.employeeId),
        tenantName: principal.tenantName,
        employeeId: principal.employeeId,
        publicUse: false,
      });
      return reply.type('text/plain; charset=utf-8').send(jwt);
    },
  );

  /* ====================================================================== */
  /* GET /api/profile                                                       */
  /* ====================================================================== */
  app.get(
    '/profile',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Get the signed-in profile',
        description: 'Combines the `public.user` row with the employee name in the tenant database.',
        security: BEARER,
        response: {
          200: userProfileSchema,
          401: unauthorizedResponse[401],
          403: forbiddenResponse[403],
          404: notFoundResponse[404],
        },
      },
    },
    async (request, reply) => {
      const principal = requireRootPrincipal(request);
      const user = await new UserRepository(request.userListDb()).getByIdentifier(
        principal.tenantName,
        principal.employeeId,
      );

      const result = await sql<{ firstName: string | null; lastName: string | null }>`
        select firstname as "firstName", lastname as "lastName"
          from domain.employee
         where id = ${principal.employeeId}::uuid
      `.execute(request.tenantDb());

      const employee = result.rows[0];
      if (!employee || !user) throw new NotFoundError('Profile');

      return reply.send({
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: user.email,
        userName: user.userName,
        profileImageBase64: user.profileImage ? user.profileImage.toString('base64') : null,
      });
    },
  );

  /* ====================================================================== */
  /* PUT /api/profile                                                       */
  /* ====================================================================== */
  app.put(
    '/profile',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Update the signed-in profile',
        description: [
          'Updates name, email, username and profile picture. Changing the username requires it',
          'to be unique across the user store. Profile images are capped at 5 MB and are expected',
          'as raw base64 without a `data:` URL prefix.',
        ].join('\n'),
        security: BEARER,
        body: putProfileSchema,
        response: {
          ...okResponseSchema,
          400: validationErrorResponse[400],
          401: unauthorizedResponse[401],
          403: forbiddenResponse[403],
          404: notFoundResponse[404],
        },
      },
    },
    async (request, reply) => {
      const principal = requireRootPrincipal(request);
      const body = request.body;

      const users = new UserRepository(request.userListDb());
      const user = await users.getByIdentifier(principal.tenantName, principal.employeeId);
      if (!user?.employeeId) throw new NotFoundError('Profile');

      if (body.userName && body.userName !== user.userName) {
        if (!user.userName || user.userName.trim() === '') {
          throw new UserError('Username cannot be empty.');
        }
        if (await users.isUserNameTaken(body.userName)) {
          throw new UserError(`Username '${body.userName}' is taken.`);
        }
        user.userName = body.userName;
      }

      if (body.email !== undefined) user.email = body.email ?? null;
      if (body.profileImageBase64 !== undefined) {
        user.profileImage = decodeProfileImage(body.profileImageBase64);
      }

      await users.update({ ...user, employeeId: user.employeeId });

      if (body.firstName !== undefined || body.lastName !== undefined) {
        await request
          .tenantDb()
          .updateTable('employee')
          .set({
            // Both name columns are NOT NULL, so only overwrite them with real values.
            ...(body.firstName != null ? { firstname: body.firstName } : {}),
            ...(body.lastName != null ? { lastname: body.lastName } : {}),
          })
          .where('id', '=', user.employeeId)
          .execute();
      }

      return reply.send({ ok: true });
    },
  );

  /* ====================================================================== */
  /* PUT /api/profile/changepassword                                        */
  /* ====================================================================== */
  app.put(
    '/profile/changepassword',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Change the password',
        description:
          'Requires the current password. The new password and its confirmation must match and must not be empty.',
        security: BEARER,
        body: changePasswordSchema,
        response: {
          ...okResponseSchema,
          400: validationErrorResponse[400],
          401: unauthorizedResponse[401],
          403: forbiddenResponse[403],
        },
      },
    },
    async (request, reply) => {
      const principal = requireRootPrincipal(request);
      const { currentPassword, newPassword, confirmPassword } = request.body;

      if (!newPassword || newPassword.trim() === '') {
        throw new UserError('New password cannot be empty.');
      }
      if (newPassword !== confirmPassword) {
        throw new UserError('New password does not match with confirmed password');
      }

      const users = new UserRepository(request.userListDb());
      const user = await users.getByIdentifier(principal.tenantName, principal.employeeId);
      if (!user?.employeeId || !(await verifyPassword(currentPassword, user.password))) {
        throw new UserError('Current password does not match.');
      }

      await users.update({
        ...user,
        employeeId: user.employeeId,
        password: await hashPassword(newPassword),
      });

      return reply.send({ ok: true });
    },
  );

  /* ====================================================================== */
  /* DELETE /api/profile                                                    */
  /* ====================================================================== */
  app.delete(
    '/profile',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Delete the account',
        description: 'Not implemented in the original backend; retained for parity.',
        security: BEARER,
        response: {
          ...okResponseSchema,
          401: unauthorizedResponse[401],
          403: forbiddenResponse[403],
        },
      },
    },
    async (_request, reply) => reply.send({ ok: true }),
  );
};
