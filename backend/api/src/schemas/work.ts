import { z } from 'zod';
import { pagedResultSchema, uuidSchema } from './common.js';

/* ─── Enumerations ────────────────────────────────────────────────────────── */

/** `WorkStatus`. Mirrors `domain.work.userstatus`. */
export const workStatusSchema = z
  .enum(['Default', 'InProgress', 'Closed'])
  .describe('Workflow state of a work order');

/** `PaymentType`. Mirrors `domain.invoice.paymenttype`. */
export const paymentTypeSchema = z
  .number()
  .int()
  .min(1)
  .max(3)
  .describe('1 = Cash, 2 = Bank transfer, 3 = Card payment');

/** Filter accepted by `GET /api/work/page`. */
export const workFilterStatusSchema = z
  .enum(['all', 'inprogress', 'closed', 'overdue'])
  .describe('all | inprogress | closed | overdue');

/* ─── Line items ──────────────────────────────────────────────────────────── */

/** `PutProductOrService`, also returned as the line items of an activity. */
export const productSchema = z
  .object({
    id: uuidSchema.describe(
      'Line item id. The nil UUID (00000000-0000-0000-0000-000000000000) marks a newly typed row.',
    ),
    code: z.string().nullish().describe('Catalogue code. Free text for ad-hoc rows.'),
    name: z.string().nullish(),
    quantity: z.coerce.number().nullish(),
    unit: z.string().nullish().describe('Unit of measure, e.g. `pcs` or `h`'),
    price: z.coerce.number().nullish(),
    discount: z.coerce.number().int().nullish().describe('Whole percentage'),
  })
  .describe('A product or service line');

/** `PriceSummary`. */
export const priceSummarySchema = z
  .object({
    totalWithVat: z.number(),
    totalWithoutVat: z.number(),
  })
  .describe('Totals for a set of line items');

/* ─── Activities ──────────────────────────────────────────────────────────── */

/** `ActivityDto` — an offer or a repair job, as listed on a work order. */
export const activitySchema = z
  .object({
    id: uuidSchema,
    number: z.string().nullable().describe('Sequential number within the work order'),
    startedOn: z.string().nullable(),
    startedBy: z.string().nullable().describe('Full name of the employee who started it'),
    name: z.string().nullable().describe('`offer` or `repairjob`'),
    notes: z.string().nullable(),
    isVehicleLinesOnPricing: z.boolean().nullable(),
    isEmpty: z.boolean().nullable().describe('True when the activity has no line items'),
  })
  .describe('A work activity');

/** The selected activity, with its lines and totals. */
export const currentActivitySchema = z
  .object({
    id: uuidSchema,
    notes: z.string().nullable(),
    isVehicleLinesOnPricing: z.boolean().nullable(),
    products: z.array(productSchema).nullable(),
    priceSummary: priceSummarySchema.nullable(),
  })
  .describe('The currently selected activity');

export const activitiesSchema = z
  .object({
    items: z.array(activitySchema).nullable(),
    current: currentActivitySchema.nullable(),
  })
  .describe('Activities of a work order');

/** Response of `GET /api/work/{id}/activities` when nothing is selected. */
export const emptyActivitiesSchema = z.object({}).loose().describe('No activities');

/* ─── Issuance ────────────────────────────────────────────────────────────── */

/** `IssuanceDto`. */
export const issuanceSchema = z
  .object({
    sentOn: z.string().nullable(),
    issuedOn: z.string().nullable(),
    issuedBy: z.string().nullable(),
    receiverEmail: z.string().nullable(),
  })
  .describe('Issuance details');

/** `WorkIssuanceDto` — adds the invoice-specific fields. */
export const workIssuanceSchema = issuanceSchema
  .extend({
    invoiceNumber: z.number().int().nullable(),
    dueDays: z.number().int().nullable(),
    isPaid: z.boolean().nullable(),
  })
  .describe('Invoice issuance details');

/** `OfferIssuanceDto` — adds the estimate-specific fields. */
export const offerIssuanceSchema = issuanceSchema
  .extend({
    id: uuidSchema.nullable().describe('Id of the offer this estimate belongs to'),
    number: z.string().nullable().describe('Estimate number'),
    acceptedBy: z.string().nullable(),
    acceptedOn: z.string().nullable(),
  })
  .describe('Estimate issuance details');

export const offerIssuanceListSchema = z.array(offerIssuanceSchema).describe('Estimates of a work order');

/* ─── Work order ──────────────────────────────────────────────────────────── */

/** `{id, name}` projection used for assigned mechanics. */
export const mechanicRefSchema = z
  .object({ id: uuidSchema, name: z.string().nullable() })
  .describe('An assigned mechanic');

/** Response of `GET /api/work/{id}`. */
export const workSchema = z
  .object({
    id: uuidSchema,
    number: z.string().nullable().describe('Work order number'),
    startedOn: z.string().nullable(),
    startedBy: z.string().nullable(),
    name: z.string().nullable().describe('Always `work`; present so the payload matches `IActivity`'),
    isEmpty: z.boolean().nullable().describe('True when no activity has line items'),
    clientId: uuidSchema.nullable(),
    clientName: z.string().nullable(),
    clientAddress: z.string().nullable(),
    clientEmail: z.string().nullable(),
    clientPhone: z.string().nullable(),
    vehicleId: uuidSchema.nullable(),
    vehicleProducer: z.string().nullable(),
    vehicleModel: z.string().nullable(),
    vehicleVin: z.string().nullable(),
    vehicleRegNr: z.string().nullable(),
    notes: z.string().nullable(),
    odo: z.number().int().nullable(),
    mechanics: z.array(mechanicRefSchema).nullable(),
    status: z.string().nullable().describe('`completed` once invoiced, otherwise the user status, lowercased'),
    issuance: workIssuanceSchema.nullable(),
  })
  .describe('A work order');

/** `PostOrPutWork`. */
export const postOrPutWorkSchema = z
  .object({
    clientId: uuidSchema.nullish().describe('Omit or send null for a walk-in'),
    description: z.string().nullish().describe('Work order notes'),
    vehicleId: uuidSchema.nullish().describe('Omit or send null to detach the vehicle'),
    assignedTo: z.array(uuidSchema).nullish().describe('Employee ids assigned as mechanics'),
    odo: z.coerce.number().int().nullish().describe('Odometer reading'),
    startWithOffer: z.boolean().nullish().describe('Create on create; ignored on update'),
  })
  .describe('A work order');

export const createdWorkSchema = z
  .object({
    workId: uuidSchema,
    activityId: uuidSchema.describe('Id of the offer or repair job that was started'),
  })
  .describe('The created work order and its first activity');

/** `PutActivityDto`. Note the original field-name typo, preserved deliberately. */
export const putActivitySchema = z
  .object({
    notes: z.string().nullish(),
    isVehicelLinesOnPricing: z
      .boolean()
      .nullish()
      .describe('Show the vehicle block on the printed pricing. Spelling matches the original API.'),
  })
  .describe('Activity metadata');

/** `SendPricingDto`. */
export const sendPricingSchema = z
  .object({
    emailAddress: z.string().min(1).describe('Recipient'),
    displayName: z.string().nullish(),
  })
  .describe('Pricing delivery request');

/** `IssuePricingDto`. */
export const issuePricingSchema = z
  .object({
    showVehicleOnPricing: z.boolean().nullish(),
    sendClientEmail: z.boolean().nullish().describe('Requires `clientEmail`'),
    clientEmail: z.string().nullish(),
  })
  .describe('Estimate issuance request');

/** `IssueInvoiceDto`. */
export const issueInvoiceSchema = z
  .object({
    paymentType: paymentTypeSchema,
    dueDays: z.coerce
      .number()
      .int()
      .min(0)
      .describe('Days until payment is due'),
    sendClientEmail: z.boolean().nullish().describe('Requires `clientEmail`'),
    clientEmail: z.string().nullish(),
  })
  .describe('Invoice issuance request');

/** Body of `PUT /api/work/{id}/invoice/paid` — a bare JSON boolean. */
export const paidBodySchema = z.boolean();

/** Body of `PUT /api/work/{id}/estimate/{n}/accepted/{job}` — a bare JSON string. */
export const notesBodySchema = z.string().nullish();

/* ─── Work list ───────────────────────────────────────────────────────────── */

/**
 * `WorkPage`.
 *
 * `issuance` is populated in the invoiced view (`issued=on`); `offerIssuance`,
 * `hasRepairs` and `numberOfOffers` are populated in the work view.
 */
export const workPageItemSchema = z
  .object({
    id: uuidSchema,
    workNr: z.string().nullable().describe('Work order number'),
    startedOn: z.string().nullable(),
    sentOn: z.string().nullable(),
    status: z.string().nullable().describe('`completed`, `default`, `inprogress` or `closed`'),
    issued: z.string().nullable(),
    clientId: uuidSchema.nullable(),
    clientName: z.string().nullable(),
    vehicleId: uuidSchema.nullable(),
    regNr: z.string().nullable(),
    mechanicNames: z.string().nullable().describe('Assigned mechanics, joined with `/ `'),
    notes: z.string().nullable(),
    hasRepairs: z.boolean().nullable().describe('Work view only: has at least one repair job'),
    numberOfOffers: z.number().int().nullable().describe('Work view only: number of offers'),
    offerIssuance: z
      .object({
        id: uuidSchema.nullable(),
        number: z.string().nullable(),
        acceptedOn: z.string().nullable(),
        acceptedBy: z.string().nullable(),
        sentOn: z.string().nullable(),
        issuedOn: z.string().nullable(),
        issuedBy: z.string().nullable(),
        receiverEmail: z.string().nullable(),
      })
      .nullable()
      .describe('Work view only: issuance of the single offer, when there is exactly one'),
    issuance: z
      .object({
        invoiceNumber: z.number().int().nullable(),
        isPaid: z.boolean().nullable(),
        dueDays: z.number().int().nullable(),
        issuedOn: z.string().nullable(),
        issuedBy: z.string().nullable(),
        sentOn: z.string().nullable(),
        receiverEmail: z.string().nullable(),
      })
      .nullable()
      .describe('Invoiced view only'),
  })
  .describe('A work order, as shown in search results');

export const workPageSchema = pagedResultSchema(workPageItemSchema, 'A page of work orders');

/** `GET /api/work/page` query. */
export const workPageQuerySchema = z
  .object({
    searchText: z.string().optional(),
    orderby: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(30),
    offset: z.coerce.number().int().min(0).optional().default(0),
    desc: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((v) => v === true || v === 'true'),
    status: workFilterStatusSchema.optional().describe('`all` disables the status filter'),
    issued: z
      .enum(['on', 'off'])
      .optional()
      .describe('`on` lists invoiced work orders instead of open ones'),
    saleable: z
      .string()
      .optional()
      .describe('All line items must match; tokens are ANDed and matched case-insensitively'),
    workFrom: z.string().optional().describe('Inclusive lower bound on the start date'),
    workTo: z.string().optional().describe('Exclusive upper bound on the start date'),
    invoiceFrom: z.string().optional(),
    invoiceTo: z.string().optional(),
    clientId: z.string().optional().describe('Client id filter. Also accepted as `clientiId[value]`.'),
    vehicleId: z.string().optional().describe('Vehicle id filter. Also accepted as `vehicleId[value]`.'),
  })
  .loose()
  .describe('Work order search filters');
