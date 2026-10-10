import { chromium } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import {
  pricingDisplayName,
  pricingFileName,
  pricingTotal,
  type PricingDocument,
} from '../db/repositories/pricings.js';
import type { AppOptions } from '../db/repositories/tenant-config.js';

/**
 * Port of `PdfGenerator` and the `Views/Print` Razor templates.
 *
 * The original rendered `Print/PricingOutput.cshtml` through Razor, injected
 * `tailwind.css` and `print.css` served by the app, and printed it with Puppeteer
 * to an A4 PDF. Here the markup is built directly and the two utility stylesheets
 * are inlined, so rendering needs no network round-trip and no Razor engine.
 *
 * Only the classes the templates actually used are reproduced. Chromium is
 * launched per call, matching the original's short-lived browser, which matters
 * because `PdfGenerator` deleted the cached PDF on every run.
 */

/** Escapes text for interpolation into HTML. */
export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `DateTime.ToString("dd.MM.yyyy")`. */
function dayMonthYear(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/** `decimal.ToString("0.00")` — always two decimals, never scientific notation. */
function twoDecimals(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

const STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111827;
    background: #fff;
  }
  .grid { display: grid; }
  .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-rows-3 { grid-template-rows: repeat(3, minmax(0, 1fr)); }
  .gap-2 { gap: 0.5rem; }
  .mt-2 { margin-top: 0.5rem; }
  .mt-8 { margin-top: 2rem; }
  .pt-2 { padding-top: 0.5rem; }
  .pr-3 { padding-right: 0.75rem; }
  .pr-0 { padding-right: 0; }
  .pl-0 { padding-left: 0; }
  .pl-2 { padding-left: 0.5rem; }
  .pl-4 { padding-left: 1rem; }
  .pr-2 { padding-right: 0.5rem; }
  .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
  .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .text-right { text-align: right; }
  .text-start { text-align: left; }
  .text-end { text-align: right; }
  .text-xs { font-size: 0.75rem; }
  .text-sm { font-size: 0.875rem; }
  .text-lg { font-size: 1.125rem; }
  .text-2xl { font-size: 1.5rem; }
  .text-3xl { font-size: 1.875rem; }
  .font-light { font-weight: 300; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .text-gray-200 { color: #e5e7eb; }
  .text-gray-300 { color: #d1d5db; }
  .text-gray-500 { color: #6b7280; }
  .text-gray-900 { color: #111827; }
  .text-indigo-500 { color: #6366f1; }
  .border-indigo-600 { border-color: #4f46e5; }
  .border-t-2 { border-top-width: 2px; }
  .border-t { border-top-width: 1px; }
  .border-gray-200 { border-color: #e5e7eb; }
  .border-gray-300 { border-color: #d1d5db; }
  .divide-y > * + * { border-top-width: 1px; border-top-style: solid; }
  .divide-y > * + * { border-color: #e5e7eb; }
  .whitespace-nowrap { white-space: nowrap; }
  .whitespace-pre-line { white-space: pre-line; }
  .min-w-full { min-width: 100%; }
  .w-full { width: 100%; }
  .w-15 { width: 3.75rem; }
  .w-35 { width: 8.75rem; }
  .flex { display: flex; }
  .flex-row-reverse { flex-direction: row-reverse; }
  .float-right { float: right; }
  table { border-collapse: collapse; width: 100%; }
  table[border="1"] th, table[border="1"] td { border: 1px solid #d1d5db; }
  footer { border-top: 1px solid #e5e7eb; }
`;

/** `Print/PricingOutput.cshtml` and its partials, flattened. */
export function pricingHtml(
  pricing: PricingDocument,
  options: AppOptions,
): string {
  const requisites = options.requisites;
  const isInvoice = pricing.kind === 'invoice';
  const hasDiscounts = pricing.lines.some((line) => line.discount !== 0);

  const total = pricingTotal(pricing, false);
  const totalWithVat = pricingTotal(pricing, true);
  const vat = Math.round((totalWithVat - total + Number.EPSILON) * 100) / 100;

  // `Print/LeftTop.Invoice.cshtml`
  const leftTop = isInvoice
    ? `<p class="text-sm text-gray-500">Date: ${escapeHtml(dayMonthYear(pricing.issuedOn))}</p>
       <p class="text-sm text-gray-500">Terms: ${pricing.paymentType === 1 ? 'cash' : 'bank transfer'}
         <br />Due date: ${escapeHtml(dayMonthYear(addDays(pricing.issuedOn, pricing.dueDays ?? 0)))}</p>
       <p class="text-sm text-gray-500">Late payment fee: ${escapeHtml(options.pricing.invoice.surCharge)}</p>`
    : `<p class="text-sm text-gray-500">Date: ${escapeHtml(dayMonthYear(pricing.issuedOn))}</p>`;

  const headerCells = [
    '<th class="pl-0 pr-2 py-1 text-start font-light text-sm font-semibold text-gray-900">Service / Product name</th>',
    '<th class="px-2 py-1 text-end font-light text-sm font-semibold whitespace-nowrap text-gray-900">Quantity</th>',
    '<th class="px-2 py-1 text-end font-light text-sm font-semibold whitespace-nowrap text-gray-900">Unit</th>',
    '<th class="px-2 py-1 text-end font-light text-sm font-semibold whitespace-nowrap text-gray-900">Unit price</th>',
    hasDiscounts
      ? '<th class="px-2 py-1 text-end font-light text-sm font-semibold whitespace-nowrap text-gray-900">Discount %</th>'
      : '',
    '<th class="pl-2 pr-0 py-1 text-end font-light text-sm font-semibold whitespace-nowrap text-gray-900">Amount</th>',
  ].join('');

  const bodyRows = pricing.lines
    .map(
      (line) => `<tr>
        <td class="w-full text-start pl-0 pr-2 py-1 text-sm text-gray-900">${escapeHtml(line.description)}</td>
        <td class="w-15 text-end px-2 py-1 text-sm whitespace-nowrap text-gray-900">${escapeHtml(String(line.quantity))}</td>
        <td class="w-15 text-end px-2 py-1 text-sm whitespace-nowrap text-gray-900">${escapeHtml(line.unit)}</td>
        <td class="w-15 text-end px-2 py-1 text-sm whitespace-nowrap text-gray-900">${twoDecimals(line.unitPrice)}</td>
        ${hasDiscounts ? `<td class="w-15 text-end px-2 py-1 text-sm whitespace-nowrap text-gray-900">${line.discount !== 0 ? `${escapeHtml(String(line.discount))} %` : ''}</td>` : ''}
        <td class="w-15 text-end pl-2 pr-0 py-1 text-sm whitespace-nowrap text-gray-900">${twoDecimals(line.total)}</td>
      </tr>`,
    )
    .join('\n');

  // `Print/LeftBottom.*` and `Print/RightBottom.*`
  const issuedByLine = isInvoice
    ? `<p class="text-sm text-gray-500">Invoice issued by: ${escapeHtml(pricing.issuedBy)}</p>`
    : `<p class="text-sm text-gray-500">Estimate issued by: ${escapeHtml(pricing.issuedBy)}</p>`;

  const disclaimer = isInvoice
    ? `<p class="text-sm whitespace-pre-line text-gray-500">${escapeHtml(options.pricing.invoice.disclaimer)}</p>`
    : '';

  const signatureLine =
    isInvoice && options.pricing.invoice.signatureLine
      ? '<p class="text-sm text-gray-500">Signature:</p>'
      : '';

  const partyCode = pricing.partyCode?.trim()
    ? `<p class="text-sm text-gray-500">${escapeHtml(pricing.partyCode)}</p>`
    : '';

  const partyAddress = pricing.partyAddress?.trim()
    ? `<p class="text-sm text-gray-500">Address: ${escapeHtml(pricing.partyAddress)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(pricingDisplayName(pricing))}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="grid grid-cols-2">
  <div>
    <h1 class="text-indigo-500 font-medium text-3xl" id="logo">${escapeHtml(requisites.name)}</h1>
    <p class="text-lg text-gray-500">${escapeHtml(requisites.phone)}</p>
  </div>
  <div class="text-right">
    <p class="text-2xl font-medium text-gray-500">${escapeHtml(pricingDisplayName(pricing))}</p>
  </div>
</div>

<div class="grid grid-cols-2 mt-8">
  <div>${leftTop}</div>
  <div class="text-right">
    <p class="text-sm text-gray-500">${escapeHtml(pricing.partyName)}</p>
    ${partyCode}
    ${partyAddress}
  </div>
</div>

<table border="1" class="mt-2 min-w-full divide-y divide-gray-300">
  <thead><tr>${headerCells}</tr></thead>
  <tbody class="divide-y divide-gray-200">
${bodyRows}
  </tbody>
</table>

<div class="pricesummary grid grid-cols-2">
  <div>
    <div class="grid grid-rows-3 gap-2 pt-2 pl-0">
      <p class="pt-2 text-start text-sm font-light text-gray-900 pl-0">${escapeHtml(pricing.vehicleLine1)}</p>
      <p class="pt-2 text-start text-sm font-light text-gray-900 pl-0">${escapeHtml(pricing.vehicleLine2)}</p>
      <p class="pt-2 text-start text-sm font-light text-gray-900 pl-0">${escapeHtml(pricing.vehicleLine3)}</p>
      <p class="pt-2 text-start text-sm font-light text-gray-900 pl-0">${escapeHtml(pricing.vehicleLine4)}</p>
    </div>
  </div>
  <div class="text-right">
    <div class="grid grid-rows-3 gap-2 pt-2 pr-0">
      <div class="flex flex-row-reverse">
        <div class="pt-2 pl-4 text-end text-sm font-light text-gray-500 pl-0 w-35">${twoDecimals(total)} EUR</div>
        <div class="pt-2 pr-3 pl-4 text-right text-sm font-light text-gray-500 pl-0">Total</div>
      </div>
      <div class="flex flex-row-reverse">
        <div class="pt-2 pl-4 text-end text-sm font-light text-gray-500 pl-0 w-35">${twoDecimals(vat)} EUR</div>
        <div class="pt-2 pr-3 pl-4 text-right text-sm font-light text-gray-500 pl-0">VAT</div>
      </div>
      <div class="flex flex-row-reverse">
        <div class="pt-2 pl-4 text-end text-sm font-semibold text-gray-900 pl-0 w-35">${twoDecimals(totalWithVat)} EUR</div>
        <div class="pt-2 pr-3 pl-4 text-right text-sm font-semibold text-gray-900 pl-0">To pay</div>
      </div>
    </div>
  </div>
</div>

<div class="grid grid-cols-2 mt-2">
  <div>${issuedByLine}</div>
  <div class="float-right"><div>${disclaimer}</div></div>
</div>
<div class="grid grid-cols-2">
  <div>${signatureLine}</div>
  <div class="float-right">${signatureLine}</div>
</div>

<footer class="border-t border-gray-200 w-full min-w-full grid grid-cols-2">
  <div class="mt-2">
    <p class="text-xs">${escapeHtml(requisites.name)}</p>
    <p class="text-xs">${escapeHtml(requisites.address)}</p>
    <p class="text-xs">${escapeHtml(requisites.email)}</p>
  </div>
  <div class="mt-2 text-right">
    <div>
      <p class="text-xs">${escapeHtml(requisites.bankAccount)}</p>
      <p class="text-xs">Registration code: ${escapeHtml(requisites.regNr)}</p>
      <p class="text-xs">VAT no: ${escapeHtml(requisites.kmkr)}</p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

let browserPathChecked = false;

/**
 * `PdfGenerator.Print`. A4, no background graphics, no header/footer — the same
 * `PdfOptions` the original passed.
 */
export async function pricingPdf(html: string): Promise<Buffer> {
  if (!browserPathChecked) {
    browserPathChecked = true;
    if (!config.pdf.chromiumPath) {
      throw new Error(
        'PLAYWRIGHT_CHROMIUM_PATH is not configured; a Chromium build is required to render PDFs.',
      );
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: config.pdf.chromiumPath,
    // Matches the original launch arguments, which are needed inside containers.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 2880 } });

    await page.setContent(html, { waitUntil: 'load' });

    const pdf = await page.pdf({
      printBackground: false,
      format: 'A4',
      displayHeaderFooter: false,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * `PdfGenerator.Generate` — render, then replace the cached PDF so the file on
 * disk always matches what was just produced.
 */
export async function generatePricingPdf(
  pricing: PricingDocument,
  options: AppOptions,
): Promise<{ bytes: Buffer; fileName: string }> {
  const fileName = pricingFileName(pricing);
  const bytes = await pricingPdf(pricingHtml(pricing, options));

  await mkdir(config.pdf.directory, { recursive: true });
  await writeFile(path.join(config.pdf.directory, fileName), bytes);

  return { bytes, fileName };
}

/** `WorkController.DeletePdf`. */
export async function deleteCachedPdf(fileName: string): Promise<void> {
  await rm(path.join(config.pdf.directory, fileName), { force: true });
}
