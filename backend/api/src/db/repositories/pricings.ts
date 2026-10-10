import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/**
 * Read side of `PricingsController`, plus the projection `PricingOutput.cshtml`
 * needs. The legacy generator loaded whole NHibernate entities here; only the
 * handful of fields the templates touch are selected.
 */

export type PricingKind = 'invoice' | 'estimate';

export interface PricingLine {
  nr: number;
  description: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  discount: number;
  total: number;
  totalWithVat: number;
}

export interface PricingDocument {
  kind: PricingKind;
  id: string;
  number: string;
  issuedOn: string;
  issuedBy: string | null;
  email: string | null;
  sentOn: string | null;
  printedOn: string | null;
  partyName: string;
  partyAddress: string | null;
  partyCode: string | null;
  vehicleLine1: string | null;
  vehicleLine2: string | null;
  vehicleLine3: string | null;
  vehicleLine4: string | null;
  /** Invoices only. */
  paymentType: number | null;
  dueDays: number | null;
  lines: PricingLine[];
}

export function pricingFileName(pricing: { kind: PricingKind; number: string }): string {
  return `${pricing.kind === 'invoice' ? 'invoice' : 'estimate'}_nr_${pricing.number}.pdf`;
}

export function pricingDisplayName(pricing: {
  kind: PricingKind;
  number: string;
}): string {
  const label = pricing.kind === 'invoice' ? 'Invoice' : 'Estimate';
  return `${label} nr. ${pricing.number}`;
}

/** `Pricing.GetTotal`. */
export function pricingTotal(pricing: PricingDocument, withVat: boolean): number {
  const total = pricing.lines.reduce(
    (sum, line) => sum + (withVat ? line.totalWithVat : line.total),
    0,
  );
  return Math.round(total * 100) / 100;
}

export class PricingsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** `PricingsController.PrintInvoice`'s lookup: the work order's invoice. */
  async invoiceForWork(workId: string): Promise<PricingDocument | null> {
    const id = await this.invoiceIdOfWork(workId);
    if (!id) return null;
    return this.invoice(id);
  }

  /** `PricingsController.PrintEstimatePdf`'s lookup: the offer's estimate. */
  async estimateForOffer(offerId: string): Promise<PricingDocument | null> {
    const result = await sql<{ estimateid: string | null }>`
      SELECT estimateid FROM domain.offer WHERE id = ${offerId}::uuid
    `.execute(this.db);

    const estimateId = result.rows[0]?.estimateid;
    if (!estimateId) return null;
    return this.estimate(estimateId);
  }

  /** Loads an invoice and its lines. */
  async invoice(invoiceId: string): Promise<PricingDocument | null> {
    const header = await sql<PricingHeader>`
      SELECT p.id,
             i.number::text as number,
             p.issuedon,
             concat_ws(' ', e.firstname, e.lastname) as issuedby,
             p.email,
             p.senton,
             p.printedon,
             p.partyname,
             p.partyaddress,
             p.partycode,
             p.vehicleline1, p.vehicleline2, p.vehicleline3, p.vehicleline4,
             i.paymenttype,
             i.duedays
        FROM domain.pricing p
          inner join domain.invoice i ON i.id = p.id
          inner join domain.employee e ON e.id = p.issuerid
       WHERE p.id = ${invoiceId}::uuid
    `.execute(this.db);

    const row = header.rows[0];
    if (!row) return null;

    return {
      kind: 'invoice',
      ...this.shape(row),
      paymentType: row.paymenttype === null ? null : Number(row.paymenttype),
      dueDays: row.duedays === null ? null : Number(row.duedays),
      lines: await this.lines(invoiceId),
    };
  }

  /** Loads an estimate and its lines. */
  async estimate(estimateId: string): Promise<PricingDocument | null> {
    const header = await sql<PricingHeader>`
      SELECT p.id,
             est.number,
             p.issuedon,
             concat_ws(' ', e.firstname, e.lastname) as issuedby,
             p.email,
             p.senton,
             p.printedon,
             p.partyname,
             p.partyaddress,
             p.partycode,
             p.vehicleline1, p.vehicleline2, p.vehicleline3, p.vehicleline4
        FROM domain.pricing p
          inner join domain.estimate est ON est.id = p.id
          inner join domain.employee e ON e.id = p.issuerid
       WHERE p.id = ${estimateId}::uuid
    `.execute(this.db);

    const row = header.rows[0];
    if (!row) return null;

    return {
      kind: 'estimate',
      ...this.shape(row),
      paymentType: null,
      dueDays: null,
      lines: await this.lines(estimateId),
    };
  }

  /** Loads either kind, for the mailer. */
  async find(pricingId: string): Promise<PricingDocument | null> {
    const kind = await sql<{ kind: PricingKind }>`
      SELECT case
               when exists (select 1 from domain.invoice where id = p.id) then 'invoice'
               else 'estimate'
             end as kind
        FROM domain.pricing p
       WHERE p.id = ${pricingId}::uuid
    `.execute(this.db);

    const found = kind.rows[0]?.kind;
    if (!found) return null;
    return found === 'invoice' ? this.invoice(pricingId) : this.estimate(pricingId);
  }

  private shape(row: PricingHeader): Omit<PricingDocument, 'kind' | 'paymentType' | 'dueDays' | 'lines'> {
    return {
      id: row.id,
      number: row.number ?? '',
      issuedOn: row.issuedon instanceof Date ? row.issuedon.toISOString() : String(row.issuedon ?? ''),
      issuedBy: row.issuedby,
      email: row.email,
      sentOn: iso(row.senton),
      printedOn: iso(row.printedon),
      partyName: row.partyname ?? '',
      partyAddress: row.partyaddress,
      partyCode: row.partycode,
      vehicleLine1: row.vehicleline1,
      vehicleLine2: row.vehicleline2,
      vehicleLine3: row.vehicleline3,
      vehicleLine4: row.vehicleline4,
    };
  }

  private async lines(pricingId: string): Promise<PricingLine[]> {
    const result = await sql<{
      nr: number;
      description: string;
      quantity: number;
      unitprice: number;
      unit: string;
      discount: number;
      total: number;
      totalwithvat: number;
    }>`
      SELECT nr, description, quantity, unitprice, unit, discount, total, totalwithvat
        FROM domain.pricingline
       WHERE pricingid = ${pricingId}::uuid
       ORDER BY nr
    `.execute(this.db);

    return result.rows.map((row) => ({
      nr: Number(row.nr),
      description: row.description,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unitprice),
      unit: row.unit,
      discount: Number(row.discount ?? 0),
      total: Number(row.total),
      totalWithVat: Number(row.totalwithvat),
    }));
  }

  private async invoiceIdOfWork(workId: string): Promise<string | null> {
    const result = await sql<{ invoiceid: string | null }>`
      SELECT invoiceid FROM domain.work WHERE id = ${workId}::uuid
    `.execute(this.db);
    return result.rows[0]?.invoiceid ?? null;
  }
}

interface PricingHeader {
  id: string;
  number: string | null;
  issuedon: Date | string | null;
  issuedby: string | null;
  email: string | null;
  senton: Date | string | null;
  printedon: Date | string | null;
  partyname: string | null;
  partyaddress: string | null;
  partycode: string | null;
  vehicleline1: string | null;
  vehicleline2: string | null;
  vehicleline3: string | null;
  vehicleline4: string | null;
  paymenttype?: number | null;
  duedays?: number | null;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
