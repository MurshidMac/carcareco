import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../types.js';

/** Port of `ITenantConfigRepository` / `TenantConfigService`. */

export interface Requisites {
  name: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  bankAccount: string | null;
  regNr: string | null;
  kmkr: string | null;
}

export interface Pricing {
  vatRate: number;
  surCharge: string | null;
  disclaimer: string | null;
  signatureLine: boolean;
  invoiceEmailContent: string | null;
  estimateEmailContent: string | null;
}

export interface AppOptions {
  requisites: Requisites;
  pricing: {
    invoice: {
      vatRate: number;
      surCharge: string | null;
      disclaimer: string | null;
      signatureLine: boolean;
      emailContent: string | null;
    };
    estimate: { emailContent: string | null };
  };
}

export class TenantConfigRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async getRequisites(): Promise<Requisites> {
    const row = await this.db
      .selectFrom('tenant_config.requisites')
      .select([
        'name',
        'phone',
        'address',
        'email',
        'bank_account as bankAccount',
        'reg_nr as regNr',
        'tax_id as kmkr',
      ])
      .executeTakeFirst();

    if (!row) throw new Error('tenant_config.requisites is empty; run the migrations.');
    return row;
  }

  async saveRequisites(requisites: Requisites): Promise<void> {
    await this.db
      .updateTable('tenant_config.requisites')
      .set({
        name: requisites.name ?? '',
        phone: requisites.phone,
        address: requisites.address,
        email: requisites.email,
        bank_account: requisites.bankAccount,
        reg_nr: requisites.regNr,
        tax_id: requisites.kmkr,
        updated_at: sql`now()`,
      })
      .execute();
  }

  async getPricing(): Promise<Pricing> {
    const row = await this.db
      .selectFrom('tenant_config.pricing')
      .select([
        'vat_rate as vatRate',
        'surcharge as surCharge',
        'disclaimer',
        'signature_line as signatureLine',
        'invoice_email_content as invoiceEmailContent',
        'estimate_email_content as estimateEmailContent',
      ])
      .executeTakeFirst();

    if (!row) throw new Error('tenant_config.pricing is empty; run the migrations.');
    return row;
  }

  async savePricing(pricing: Pricing): Promise<void> {
    await this.db
      .updateTable('tenant_config.pricing')
      .set({
        vat_rate: pricing.vatRate,
        surcharge: pricing.surCharge,
        disclaimer: pricing.disclaimer,
        signature_line: pricing.signatureLine,
        invoice_email_content: pricing.invoiceEmailContent,
        estimate_email_content: pricing.estimateEmailContent,
        updated_at: sql`now()`,
      })
      .execute();
  }

  /** `TenantConfigService.GetAppOptionsAsync`. */
  async getAppOptions(): Promise<AppOptions> {
    const [requisites, pricing] = await Promise.all([this.getRequisites(), this.getPricing()]);
    return {
      requisites,
      pricing: {
        invoice: {
          vatRate: pricing.vatRate,
          surCharge: pricing.surCharge,
          disclaimer: pricing.disclaimer,
          signatureLine: pricing.signatureLine,
          emailContent: pricing.invoiceEmailContent,
        },
        estimate: { emailContent: pricing.estimateEmailContent },
      },
    };
  }

  /** `TenantConfigService.SaveAppOptionsAsync`. */
  async saveAppOptions(options: AppOptions): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const repo = new TenantConfigRepository(tx);
      await repo.saveRequisites(options.requisites);
      await repo.savePricing({
        vatRate: options.pricing.invoice.vatRate,
        surCharge: options.pricing.invoice.surCharge,
        disclaimer: options.pricing.invoice.disclaimer,
        signatureLine: options.pricing.invoice.signatureLine,
        invoiceEmailContent: options.pricing.invoice.emailContent,
        estimateEmailContent: options.pricing.estimate.emailContent,
      });
    });
  }
}
