import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import geistLatinExt from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?inline";

import type { DocumentText, QuoteDocumentContent, QuoteDocumentGroup, QuoteDocumentLine } from "../quote-document";
import type { PrintablePage } from "../pdf-renderer.server";

/**
 * Standard Quote Layout, version 1. Do not change its appearance: published
 * revisions keep rendering with it (ADR 0004). Deliberate design changes
 * belong in a new version. Fixes that restore what this version was meant
 * to show may go here.
 */
export function renderStandardV1(content: QuoteDocumentContent): PrintablePage {
  return {
    html: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escape(content.filename)}</title><style>${styles}</style></head><body>${body(content)}</body></html>`,
    headerTemplate: "<span></span>",
    footerTemplate: footer(content),
    margin: { top: "16mm", right: "16mm", bottom: "20mm", left: "20mm" },
  };
}

function body(content: QuoteDocumentContent): string {
  const facts = [
    ["Référence", text(content.reference)],
    ["Date", text(content.issueDate)],
    ...(content.revisionLabel ? [["Révision", escape(content.revisionLabel.replace(/^Révision /, ""))]] : []),
    ...(content.siteAddress ? [["Chantier", multiline(content.siteAddress)]] : []),
  ];
  return `
${content.draft ? `<div class="watermark" aria-hidden="true"><span>BROUILLON</span></div>
<p class="draft-banner"><strong>BROUILLON</strong> · Aperçu d’un devis non publié. Ne pas transmettre au client.</p>` : ""}
<header class="letterhead">
  <div class="sender">
    ${content.business.logo ? `<img class="logo" src="${escape(content.business.logo)}" alt="">` : ""}
    <p class="business-name">${text(content.business.name)}</p>
    <p>${text(content.business.address, true)}</p>
    ${content.business.contact ? `<p>${multiline(content.business.contact)}</p>` : ""}
    ${content.business.vatId ? `<p>${escape(content.business.vatId)}</p>` : ""}
  </div>
  <address class="recipient">
    <p class="recipient-name">${text(content.customer.name)}</p>
    <p>${text(content.customer.address, true)}</p>
    ${content.customer.contact ? `<p>${multiline(content.customer.contact)}</p>` : ""}
  </address>
</header>
<section class="heading">
  <p class="kind">Devis</p>
  <h1>${text(content.title)}</h1>
  <dl class="facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
</section>
<section class="work">
  <div class="row columns" aria-hidden="true"><span>N°</span><span>Description</span><span class="number">Quantité</span><span class="number">Prix unit.</span><span class="number">Montant</span></div>
  ${content.groups.map(group).join("")}
</section>
<section class="totals">
  ${content.totals.map((total) => `<div class="total${total.grand ? " grand" : ""}"><span>${escape(total.label)}</span><span class="number">${text(total.amount)}</span></div>`).join("")}
</section>
${content.terms || content.validity ? `<section class="terms"><h2>Conditions</h2>${content.terms ? `<p>${multiline(content.terms)}</p>` : ""}${content.validity ? `<p>${escape(content.validity)}</p>` : ""}</section>` : ""}`;
}

function group(value: QuoteDocumentGroup): string {
  const [first, ...rest] = value.lines;
  const heading = value.title ? `<h2 class="section-title">${text(value.title)}</h2>` : "";
  // A Quote Section heading stays on the same page as its first Quote Line.
  const opening = `<div class="keep-together">${heading}${first ? line(first) : ""}</div>`;
  const subtotal = value.subtotal ? `<div class="row subtotal"><span></span><span>Sous-total ${value.title && !value.title.missing ? escape(value.title.text) : ""}</span><span></span><span></span><span class="number">${text(value.subtotal)}</span></div>` : "";
  return `<div class="group">${opening}${rest.map(line).join("")}${subtotal}</div>`;
}

function line(value: QuoteDocumentLine): string {
  const pricing = value.pricing.kind === "fixed"
    ? `<span class="number">Forfait</span><span></span>`
    : `<span class="number">${text(value.pricing.quantity)} ${text(value.pricing.unit)}</span><span class="number">${text(value.pricing.unitPrice)}</span>`;
  // Short Quote Lines move to the next page whole. Long descriptions may split across pages.
  const short = value.description.text.length < 600;
  return `<div class="row line${short ? " short" : ""}"><span class="line-number">${escape(value.number)}</span><span class="description">${text(value.description, true)}</span>${pricing}<span class="number amount">${text(value.amount)}</span></div>`;
}

function footer(content: QuoteDocumentContent): string {
  const reference = content.reference.missing ? "Devis" : `Devis ${escape(content.reference.text)}`;
  const label = [content.draft ? "BROUILLON" : "", reference, content.revisionLabel ? escape(content.revisionLabel) : ""].filter(Boolean).join(" · ");
  return `<div style="width:100%;margin:0 16mm 0 20mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#5b616b;"><span>${label}</span><span>page <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
}

function text(value: DocumentText, lines = false): string {
  const shown = lines ? multiline(value.text) : escape(value.text);
  return value.missing ? `<span class="missing">${shown}</span>` : shown;
}

function multiline(value: string): string {
  return escape(value).replace(/\r?\n/g, "<br>");
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const styles = `
@font-face { font-family: "Quote Sans"; src: url("${geistLatin}") format("woff2"); font-weight: 100 900; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Quote Sans"; src: url("${geistLatinExt}") format("woff2"); font-weight: 100 900; unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@page { size: A4 portrait; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Quote Sans", Helvetica, Arial, sans-serif; font-size: 9.5pt; line-height: 1.4; color: #1d2129; font-variant-numeric: tabular-nums; orphans: 3; widows: 3; }
p { margin: 0; }
/* Clipped to the page so the rotated text cannot widen the printed layout. */
.watermark { position: fixed; inset: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; z-index: -1; }
.watermark span { transform: rotate(-30deg); font-size: 80pt; font-weight: 700; letter-spacing: 6pt; color: rgba(180, 35, 24, 0.08); white-space: nowrap; }
.draft-banner { margin: 0 0 4mm; padding: 2mm 3mm; border: 0.3mm solid #b42318; color: #b42318; font-size: 8.5pt; }
.letterhead { position: relative; height: 72mm; }
.sender { width: 80mm; font-size: 8.5pt; color: #3c424c; }
.logo { display: block; max-width: 60mm; max-height: 20mm; margin-bottom: 3mm; object-fit: contain; object-position: left top; }
.logo + .business-name { font-size: 10pt; }
.business-name { font-size: 13pt; font-weight: 650; color: #1d2129; margin-bottom: 1.5mm; }
/* Right-hand window of a Swiss C5/C6 envelope: 118 mm from the left edge, 50 mm from the top. */
.recipient { position: absolute; left: 98mm; top: 34mm; width: 72mm; height: 36mm; font-style: normal; font-size: 10pt; line-height: 1.35; overflow: hidden; }
.recipient-name { font-weight: 600; }
.heading { margin-bottom: 7mm; }
.kind { font-size: 8.5pt; font-weight: 600; letter-spacing: 1.2pt; text-transform: uppercase; color: #5b616b; }
h1 { margin: 1mm 0 4mm; font-size: 16pt; font-weight: 650; line-height: 1.2; }
.facts { display: flex; flex-wrap: wrap; gap: 2mm 10mm; margin: 0; font-size: 8.5pt; }
.facts dt { color: #5b616b; }
.facts dd { margin: 0; font-weight: 550; }
.row { display: grid; grid-template-columns: 9mm 1fr 27mm 22mm 25mm; column-gap: 3mm; }
.columns { padding-bottom: 1.5mm; border-bottom: 0.4mm solid #1d2129; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.4pt; text-transform: uppercase; color: #5b616b; }
.number { text-align: right; white-space: nowrap; }
.section-title { margin: 6mm 0 0; padding-bottom: 1.2mm; border-bottom: 0.2mm solid #c9ced6; font-size: 10.5pt; font-weight: 650; break-after: avoid; }
.keep-together { break-inside: avoid; }
.line { padding: 2mm 0; border-bottom: 0.2mm solid #e3e6ea; }
.line.short { break-inside: avoid; }
.line-number { color: #5b616b; }
.description { white-space: normal; overflow-wrap: anywhere; }
.amount { font-weight: 550; }
.subtotal { padding: 2mm 0 0; font-weight: 600; break-before: avoid; }
.totals { margin: 7mm 0 0 auto; width: 88mm; break-inside: avoid; }
.total { display: flex; justify-content: space-between; padding: 1.2mm 0; }
.total.grand { margin-top: 1mm; padding-top: 2mm; border-top: 0.4mm solid #1d2129; font-size: 11pt; font-weight: 700; }
.terms { margin-top: 9mm; font-size: 8.5pt; color: #3c424c; }
.terms h2 { margin: 0 0 1.5mm; font-size: 9pt; font-weight: 650; color: #1d2129; }
.terms p + p { margin-top: 2mm; }
.missing { color: #b42318; font-style: italic; }
`;
