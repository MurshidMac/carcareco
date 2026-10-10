import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { UserError } from '../core/errors.js';
import { deleteCachedPdf } from '../core/pricing-render.js';
import { sendPricing } from '../core/mail.js';
import { currentEmployeeId, requireRootPrincipal } from '../plugins/context.js';
import {
  forbiddenResponse,
  idSchema,
  idsBodySchema,
  notFoundResponse,
  rateLimitedResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from '../schemas/common.js';
import {
  activitiesSchema,
  createdWorkSchema,
  emptyActivitiesSchema,
  issueInvoiceSchema,
  issuePricingSchema,
  notesBodySchema,
  paidBodySchema,
  postOrPutWorkSchema,
  productSchema,
  putActivitySchema,
  sendPricingSchema,
  workPageSchema,
  workPageQuerySchema,
  workSchema,
  workStatusSchema,
} from '../schemas/work.js';
import { PricingsRepository } from '../db/repositories/pricings.js';
import { TenantConfigRepository } from '../db/repositories/tenant-config.js';
import { WorkRepository, type SaleableLine } from '../db/repositories/work.js';

/**
 * Port of `WorkController`.
 *
 * The controller was `[Authorize(Policy = "ServerSidePolicy")]`, so every action
 * needs the Root role, and carried a class-level `[TenantRateLimit]`.
 *
 * Several actions answered with an empty body (`OkResult`) even though they
 * changed something, while the ones that returned an id returned it bare. Both
 * shapes are reproduced.
 */
export const workRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const workParams = z.object({ id: z.string().uuid() });
  const activityParams = z.object({
    id: z.string().uuid(),
    offerNumber: z.coerce.number().int(),
  });

  const emptyOk = z.null().describe('Acknowledged; empty body');

  /**
   * `short? targetJobNumber`. The dialog sends an *empty* segment when it asks
   * for a new repair job, and `''` would otherwise coerce to job number 0 — which
   * is a real order number, since activities are numbered from 0. Blank is
   * therefore normalised to "absent" before coercion.
   */
  const optionalJobNumber = z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().optional(),
  );

  /** Shared response maps, so the OpenAPI document stays consistent. */
  const errors = {
    400: validationErrorResponse[400],
    401: unauthorizedResponse[401],
    403: forbiddenResponse[403],
    404: notFoundResponse[404],
    429: rateLimitedResponse[429],
  } as const;

  /** The starter/issuer/acceptor is the employee behind the token. */
  function employeeId(request: FastifyRequest): string {
    const id = currentEmployeeId(request);
    if (!id) throw new UserError('No employee is associated with this token.');
    return id;
  }

  /**
   * The line-item DTO is deliberately lenient, because the Angular grids send
   * partially filled rows; the repository wants every column settled.
   */
  function lines(products: z.infer<typeof productSchema>[]): SaleableLine[] {
    return products.map((line) => ({
      id: line.id || null,
      code: line.code ?? null,
      name: line.name ?? null,
      quantity: line.quantity ?? null,
      unit: line.unit ?? null,
      price: line.price ?? null,
      discount: line.discount ?? null,
    }));
  }

  /* ====================================================================== */
  /* Reads                                                                  */
  /* ====================================================================== */

  app.get(
    '/work/page',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Search work orders',
        description:
          'Without `issued=on` the open work orders are listed, ordered by last change; with it the invoiced ones are listed by invoice number. Ordering is always descending.',
        querystring: workPageQuerySchema,
        response: { 200: workPageSchema, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);

      const query = request.query;

      return new WorkRepository(request.tenantDb()).page({
        searchText: query.searchText,
        limit: query.limit,
        offset: query.offset,
        status: query.status,
        issued: query.issued,
        saleable: query.saleable,
        workFrom: query.workFrom,
        workTo: query.workTo,
        invoiceFrom: query.invoiceFrom,
        invoiceTo: query.invoiceTo,
        // The legacy controller read these bracket-suffixed keys straight off the
        // query string, and the Angular filters still send that shape.
        clientId: query.clientId ?? query['clientiId[value]'],
        vehicleId: query.vehicleId ?? query['vehicleId[value]'],
      });
    },
  );

  app.get(
    '/work/:id',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Get a work order',
        params: workParams,
        response: { 200: workSchema, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).findOrFail(request.params.id);
    },
  );

  app.get(
    '/work/:id/activities/:currentId?',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'List the activities of a work order',
        description:
          'Returns every offer and repair job plus the selected one with its lines and totals. `currentId` may be the nil UUID or omitted to select the most recent activity.',
        params: z.object({
          id: z.string().uuid(),
          currentId: z.string().uuid().optional(),
        }),
        response: {
          200: z.union([activitiesSchema, emptyActivitiesSchema]).describe('Activities'),
          ...errors,
        },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const { vatRate } = await new TenantConfigRepository(db).getPricing();

      return new WorkRepository(db).activities(
        request.params.id,
        request.params.currentId,
        vatRate,
      );
    },
  );

  /** `GetProductsAndServicesOfAnOffer`. */
  app.get(
    '/work/offer/:offerId/productsorservices',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'List the line items of an offer',
        params: z.object({ offerId: z.string().uuid() }),
        response: {
          200: z.array(productSchema).describe('Line items, ordered by line number'),
          ...errors,
        },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).linesOf('offer', request.params.offerId);
    },
  );

  /** `GetProductsOrServicesOfRepairJob`. */
  app.get(
    '/work/repairjob/:jobId/productsorservices',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'List the line items of a repair job',
        params: z.object({ jobId: z.string().uuid() }),
        response: {
          200: z.array(productSchema).describe('Line items, ordered by line number'),
          ...errors,
        },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).linesOf('repairjob', request.params.jobId);
    },
  );

  /* ====================================================================== */
  /* Work order lifecycle                                                   */
  /* ====================================================================== */

  app.post(
    '/work',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Start a work order',
        description:
          'Creates the work order and its first activity. With `startWithOffer` the description becomes the offer notes instead of the work order notes.',
        body: postOrPutWorkSchema,
        response: { 200: createdWorkSchema, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);

      const body = request.body;
      return new WorkRepository(request.tenantDb()).create({
        clientId: body.clientId ?? null,
        vehicleId: body.vehicleId ?? null,
        description: body.description ?? null,
        assignedTo: body.assignedTo ?? [],
        odo: body.odo ?? null,
        startWithOffer: body.startWithOffer ?? false,
        starterId: employeeId(request),
      });
    },
  );

  app.put(
    '/work/:id',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Update a work order',
        description:
          'Omitting `clientId` or `vehicleId` detaches it. `assignedTo` replaces the whole set of mechanics.',
        params: workParams,
        body: postOrPutWorkSchema,
        response: { 200: idSchema.describe('The id of the updated work order'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);

      const body = request.body;
      return new WorkRepository(request.tenantDb()).update(request.params.id, {
        clientId: body.clientId ?? null,
        vehicleId: body.vehicleId ?? null,
        description: body.description ?? null,
        assignedTo: body.assignedTo ?? [],
      });
    },
  );

  app.delete(
    '/work',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Delete work orders',
        description:
          'Refused when any of them holds an offer or invoice that was sent to a client.',
        body: idsBodySchema.describe('The work orders to delete'),
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).delete(request.body);
      return reply.code(200).send(null);
    },
  );

  app.put(
    '/work/:id/status/:status',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Change the workflow state',
        description:
          'Closing an invoiced work order is refused, and closing does not bump the last-changed timestamp so closed orders stop floating to the top of the list.',
        params: z.object({ id: z.string().uuid(), status: workStatusSchema }),
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).setStatus(
        request.params.id,
        request.params.status,
      );
      return reply.code(200).send(null);
    },
  );

  app.post(
    '/work/:id/makecopy',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Duplicate a work order',
        description:
          'Copies the work order with its repair jobs and offers; the copy is given a new number.',
        params: workParams,
        response: { 200: idSchema.describe('The id of the new work order'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).makeCopy(request.params.id, employeeId(request));
    },
  );

  /* ====================================================================== */
  /* Activities                                                             */
  /* ====================================================================== */

  app.post(
    '/work/:id/offer',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Add an offer to a work order',
        description: 'The body is the offer notes, sent as a bare JSON string.',
        params: workParams,
        body: notesBodySchema.describe('The offer notes'),
        response: { 200: idSchema.describe('The id of the new offer'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).createOffer(
        request.params.id,
        employeeId(request),
        request.body ?? null,
      );
    },
  );

  app.post(
    '/work/:id/repairjob',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Start a repair job on a work order',
        description: 'The body is the repair job notes, sent as a bare JSON string.',
        params: workParams,
        body: notesBodySchema.describe('The repair job notes'),
        response: { 200: idSchema.describe('The id of the new repair job'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).createRepairJob(
        request.params.id,
        employeeId(request),
        request.body ?? null,
      );
    },
  );

  app.put(
    '/work/:id/offer/:offerNumber',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Update an offer',
        params: activityParams,
        body: putActivitySchema,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).updateOffer(
        request.params.id,
        request.params.offerNumber,
        request.body.notes ?? null,
        request.body.isVehicelLinesOnPricing ?? false,
      );
      return reply.code(200).send(null);
    },
  );

  app.put(
    '/work/:id/repairjob/:jobNumber',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Update a repair job',
        description:
          'Only the notes are updated. The original action carried a `//todo?` about the vehicle-line flag and never wrote it.',
        params: z.object({ id: z.string().uuid(), jobNumber: z.coerce.number().int() }),
        body: putActivitySchema,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).updateRepairJob(
        request.params.id,
        request.params.jobNumber,
        request.body.notes ?? null,
      );
      return reply.code(200).send(null);
    },
  );

  app.delete(
    '/work/:id/offer/:offerNumber',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Delete an offer',
        params: activityParams,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).removeOffer(
        request.params.id,
        request.params.offerNumber,
      );
      return reply.code(200).send(null);
    },
  );

  app.delete(
    '/work/:id/repairjob/:jobNumber',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Delete a repair job',
        params: z.object({ id: z.string().uuid(), jobNumber: z.coerce.number().int() }),
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).removeRepairJob(
        request.params.id,
        request.params.jobNumber,
      );
      return reply.code(200).send(null);
    },
  );

  /* ====================================================================== */
  /* Line items                                                             */
  /* ====================================================================== */

  app.put(
    '/work/offer/:offerId/productsorservices',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Replace the line items of an offer',
        description:
          'A full replacement: lines are matched by id, a line sent with the nil UUID is inserted, and stored lines missing from the request are removed.',
        params: z.object({ offerId: z.string().uuid() }),
        body: z.array(productSchema),
        response: { 200: idSchema.describe('The id of the offer'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).replaceLines(
        'offer',
        request.params.offerId,
        lines(request.body),
      );
      return request.params.offerId;
    },
  );

  app.put(
    '/work/repairjob/:jobId/productsorservices',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Replace the line items of a repair job',
        description:
          'A full replacement: lines are matched by id, a line sent with the nil UUID is inserted, and stored lines missing from the request are removed.',
        params: z.object({ jobId: z.string().uuid() }),
        body: z.array(productSchema),
        response: { 200: idSchema.describe('The id of the repair job'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).replaceLines(
        'repairjob',
        request.params.jobId,
        lines(request.body),
      );
      return request.params.jobId;
    },
  );

  /* ====================================================================== */
  /* Estimates                                                              */
  /* ====================================================================== */

  app.put(
    '/work/:id/estimate/issue/:offerNumber',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Issue the estimate of an offer',
        description:
          'Freezes the current line items into an estimate numbered `{workNumber}-{offerNumber}`. Re-issuing copies the offer first, so an already-sent estimate number never ends up referring to different content.',
        params: activityParams,
        body: issuePricingSchema,
        response: {
          200: idSchema.describe('The id of the offer carrying the estimate'),
          ...errors,
        },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const repo = new WorkRepository(db);
      const body = request.body;

      const issued = await repo.issueEstimate({
        workId: request.params.id,
        offerNumber: request.params.offerNumber,
        vatRate: (await new TenantConfigRepository(db).getPricing()).vatRate,
        issuerId: employeeId(request),
        showVehicleOnPricing: body.showVehicleOnPricing ?? false,
      });

      if (body.sendClientEmail) {
        // `Work.Issue` refused to send without a recipient.
        const clientEmail = body.clientEmail?.trim();
        if (!clientEmail) {
          throw new UserError('Cannot send an estimate, client email not provided.');
        }

        const options = await new TenantConfigRepository(db).getAppOptions();
        const estimate = await new PricingsRepository(db).estimate(issued.estimateId);
        if (estimate) {
          await repo.markPricingSent(estimate.id, clientEmail);
          await sendPricing({ pricing: estimate, recipient: clientEmail, options });
        }
      }

      return issued.offerId;
    },
  );

  app.put(
    '/work/estimate/send/:offerId',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Email the estimate of an offer',
        params: z.object({ offerId: z.string().uuid() }),
        body: sendPricingSchema,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const repo = new WorkRepository(db);

      const estimate = await new PricingsRepository(db).estimateForOffer(
        request.params.offerId,
      );
      if (!estimate) throw new UserError('Cannot send an estimate, it has not been issued.');

      const options = await new TenantConfigRepository(db).getAppOptions();

      // `Pricing.Send` stamped the recipient and `senton` before handing off.
      await repo.markPricingSent(estimate.id, request.body.emailAddress);
      await sendPricing({ pricing: estimate, recipient: request.body.emailAddress, options });

      return reply.code(200).send(null);
    },
  );

  app.put(
    '/work/:id/estimate/:offerNumber/accepted/:targetJobNumber?',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Accept an offer',
        description:
          'Copies the offer lines onto a repair job and returns its id. Omitting `targetJobNumber`, or naming one that does not exist, creates a new job.',
        params: z.object({
          id: z.string().uuid(),
          offerNumber: z.coerce.number().int(),
          targetJobNumber: optionalJobNumber,
        }),
        body: notesBodySchema.describe('Notes for the repair job'),
        response: { 200: idSchema.describe('The id of the repair job'), ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).acceptOffer(
        request.params.id,
        request.params.offerNumber,
        request.params.targetJobNumber,
        request.body ?? null,
        employeeId(request),
      );
    },
  );

  /* ====================================================================== */
  /* Invoicing                                                              */
  /* ====================================================================== */

  app.put(
    '/work/:id/invoice/issue',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Generate the invoice of a work order',
        description:
          'Takes the next invoice number and prices the lines of every repair job, numbered continuously across jobs. The vehicle block is left blank, as `Invoice.CreateFor` always did.',
        params: workParams,
        body: issueInvoiceSchema,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const repo = new WorkRepository(db);
      const body = request.body;

      const issued = await repo.generateInvoice({
        workId: request.params.id,
        vatRate: (await new TenantConfigRepository(db).getPricing()).vatRate,
        paymentType: body.paymentType,
        dueDays: body.dueDays,
        issuerId: employeeId(request),
      });

      if (body.sendClientEmail) {
        const clientEmail = body.clientEmail?.trim();
        if (!clientEmail) {
          throw new UserError('Cannot send an invoice, client email not provided.');
        }

        const options = await new TenantConfigRepository(db).getAppOptions();
        const invoice = await new PricingsRepository(db).invoice(issued.invoiceId);
        if (invoice) {
          await repo.markPricingSent(invoice.id, clientEmail);
          await sendPricing({ pricing: invoice, recipient: clientEmail, options });
        }
      }

      return reply.code(200).send(null);
    },
  );

  app.put(
    '/work/:id/invoice/send',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Email the invoice of a work order',
        params: workParams,
        body: sendPricingSchema,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const repo = new WorkRepository(db);

      const invoiceId = await repo.invoiceIdOf(request.params.id);
      const options = await new TenantConfigRepository(db).getAppOptions();
      const invoice = await new PricingsRepository(db).invoice(invoiceId);
      if (!invoice) throw new UserError('Cannot send an invoice, it does not exist.');

      await repo.markPricingSent(invoice.id, request.body.emailAddress);
      await sendPricing({ pricing: invoice, recipient: request.body.emailAddress, options });

      return reply.code(200).send(null);
    },
  );

  app.put(
    '/work/:id/invoice/paid',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Mark an invoice paid or unpaid',
        description: 'The body is a bare JSON boolean.',
        params: workParams,
        body: paidBodySchema.describe('Payment state'),
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);
      await new WorkRepository(request.tenantDb()).markInvoicePaid(request.params.id, request.body);
      return reply.code(200).send(null);
    },
  );

  app.put(
    '/work/:id/invoice/delete',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Withdraw the invoice of a work order',
        description:
          'Only the newest invoice can be withdrawn: the attempt consumes the next number, so withdrawing an older one would leave a gap. The cached PDF is deleted as well.',
        params: workParams,
        response: { 200: emptyOk, ...errors },
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);

      const cancelled = await new WorkRepository(request.tenantDb()).cancelInvoice(
        request.params.id,
      );
      await deleteCachedPdf(cancelled.fileName);

      return reply.code(200).send(null);
    },
  );
};
