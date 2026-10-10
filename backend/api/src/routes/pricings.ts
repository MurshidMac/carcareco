import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limits } from '../core/rate-limit.js';
import { NotFoundError } from '../core/errors.js';
import { requireRootPrincipal } from '../plugins/context.js';
import { errorResponseSchema } from '../schemas/common.js';
import { offerIssuanceListSchema } from '../schemas/work.js';
import { PricingsRepository } from '../db/repositories/pricings.js';
import { TenantConfigRepository } from '../db/repositories/tenant-config.js';
import { WorkRepository } from '../db/repositories/work.js';
import { generatePricingPdf, pricingHtml } from '../core/pricing-render.js';
import { pricingFileName } from '../db/repositories/pricings.js';

/**
 * Port of `PricingsController`.
 *
 * Everything was `ServerSidePolicy`. Both print endpoints took a `{type}` segment
 * and compared it against the literal `"pdf"`; anything else rendered HTML.
 * `HtmlResult`/`PdfResult` returned 404 when the pricing did not exist, which is
 * also what happens when the work order has no invoice or the offer has no
 * estimate.
 */
export const pricingRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const typeParam = z.object({
    type: z.string().describe('`pdf` to download the document, anything else for HTML'),
  });

  /**
   * The 200 payload is either raw HTML or a PDF buffer depending on the `{type}`
   * segment. Both are declared with content-type scoped schemas so the serializer
   * compiler leaves them untouched (matching the profile picture route); the
   * content type is still set per branch on the reply. The 404 shape is declared
   * because it goes through the normal error path.
   */
  const documentResponse = {
    200: {
      description: 'The rendered document',
      content: {
        'text/html': { schema: z.string() },
        'application/pdf': { schema: z.instanceof(Buffer) },
      },
    },
    401: errorResponseSchema.describe('Authentication required'),
    403: errorResponseSchema.describe('The Root role is required'),
    404: errorResponseSchema.describe('The pricing does not exist'),
  } as const;

  app.get(
    '/pricings/offers/:workId',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'List the estimates issued for a work order',
        params: z.object({ workId: z.string().uuid() }),
        response: {
          200: offerIssuanceListSchema,
          401: errorResponseSchema.describe('Authentication required'),
          403: errorResponseSchema.describe('The Root role is required'),
        },
      },
      preHandler: limits.tenant(),
    },
    async (request) => {
      requireRootPrincipal(request);
      return new WorkRepository(request.tenantDb()).offerIssuances(request.params.workId);
    },
  );

  /** `PricingsController.PrintInvoice`. */
  app.get(
    '/pricings/invoice/:workId/:type',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Print the invoice of a work order',
        description: 'Renders the invoice as HTML, or as an A4 PDF when `type` is `pdf`.',
        params: z.object({ workId: z.string().uuid(), ...typeParam.shape }),
        response: documentResponse,
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const invoice = await new PricingsRepository(db).invoiceForWork(request.params.workId);
      if (!invoice) throw new NotFoundError('Invoice');

      const options = await new TenantConfigRepository(db).getAppOptions();

      if (request.params.type !== 'pdf') {
        return reply.type('text/html').send(pricingHtml(invoice, options));
      }

      const { bytes } = await generatePricingPdf(invoice, options);
      reply.header('content-disposition', `inline;filename=${pricingFileName(invoice)}`);
      return reply.type('application/pdf').send(bytes);
    },
  );

  /** `PricingsController.PrintEstimatePdf`. */
  app.get(
    '/pricings/offer/:offerId/:type',
    {
      schema: {
        tags: ['Work orders'],
        summary: 'Print the estimate of an offer',
        description: 'Renders the estimate as HTML, or as an A4 PDF when `type` is `pdf`.',
        params: z.object({ offerId: z.string().uuid(), ...typeParam.shape }),
        response: documentResponse,
      },
      preHandler: limits.tenant(),
    },
    async (request, reply) => {
      requireRootPrincipal(request);

      const db = request.tenantDb();
      const estimate = await new PricingsRepository(db).estimateForOffer(request.params.offerId);
      if (!estimate) throw new NotFoundError('Estimate');

      const options = await new TenantConfigRepository(db).getAppOptions();

      if (request.params.type !== 'pdf') {
        return reply.type('text/html').send(pricingHtml(estimate, options));
      }

      const { bytes } = await generatePricingPdf(estimate, options);
      reply.header('content-disposition', `inline;filename=${pricingFileName(estimate)}`);
      return reply.type('application/pdf').send(bytes);
    },
  );
};
