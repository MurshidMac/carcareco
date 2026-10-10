import { config } from '../config/index.js';
import { UserError } from './errors.js';
import {
  pricingDisplayName,
  pricingFileName,
  type PricingDocument,
} from '../db/repositories/pricings.js';
import type { AppOptions } from '../db/repositories/tenant-config.js';
import { generatePricingPdf } from './pricing-render.js';
import type * as Nodemailer from 'nodemailer';

/**
 * Port of `PricingPdfMailSender` / `ISmtpClientFactory`.
 *
 * `System.Net.Mail` was used with an `SmtpClient` built from configuration; the
 * equivalent here is nodemailer over the same host, port and credentials.
 * `SMTP_SECURE` selects implicit TLS on port 465 and STARTTLS everywhere else,
 * which is how the original factory configured it.
 */

/** Resolved lazily so tests and CLI tools that never send mail need no SMTP. */
export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  fromAddress: string;
  fromName: string;
}

export function smtpSettings(): SmtpSettings {
  return {
    host: config.smtp.host,
    port: config.smtp.port,
    user: config.smtp.user,
    password: config.smtp.password,
    secure: config.smtp.secure,
    fromAddress: config.smtp.fromAddress,
    fromName: config.smtp.fromName,
  };
}

type NodemailerModule = typeof Nodemailer;

let nodemailerPromise: Promise<NodemailerModule> | undefined;

/** Imported on demand: `nodemailer` is only needed once mail is actually sent. */
async function loadNodemailer(): Promise<NodemailerModule> {
  nodemailerPromise ??= import('nodemailer');
  return nodemailerPromise;
}

export interface SendPricingInput {
  pricing: PricingDocument;
  /** Recipient. Defaults to the address already stored on the pricing. */
  recipient?: string | null | undefined;
  options: AppOptions;
}

/**
 * `IPricingSender.Send`. Renders the PDF, attaches it under the pricing's own
 * file name and sends it from the tenant's requisites address.
 */
export async function sendPricing({ pricing, recipient, options }: SendPricingInput): Promise<{
  fileName: string;
  recipient: string;
}> {
  const to = (recipient ?? pricing.email ?? '').trim();
  if (to === '') {
    throw new UserError('Cannot send an email, recipient email not provided.');
  }

  const { bytes, fileName } = await generatePricingPdf(pricing, options);

  const body =
    pricing.kind === 'invoice'
      ? options.pricing.invoice.emailContent
      : options.pricing.estimate.emailContent;

  const nodemailer = await loadNodemailer();
  const settings = smtpSettings();

  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth:
      settings.user === ''
        ? undefined
        : { user: settings.user, pass: settings.password },
  });

  await transport.sendMail({
    from: { address: options.requisites.email || settings.fromAddress, name: options.requisites.name || settings.fromName },
    to,
    subject: pricingDisplayName(pricing),
    text: body ?? '',
    attachments: [
      {
        filename: fileName,
        content: bytes,
        contentType: 'application/pdf',
      },
    ],
  });

  return { fileName: fileName || pricingFileName(pricing), recipient: to };
}
