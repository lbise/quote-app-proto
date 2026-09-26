import { calculateQuote, money, type QuoteCalculation, type QuoteData, type QuoteLine } from "./quote";

/** The logo image the Quote names, when it belongs to the Quote's business. */
export type QuoteDocumentLogo = { contentType: string; data: Uint8Array };

export type QuoteDocumentSource = (
  | { kind: "published"; revisionNumber: number; quote: QuoteData; calculation: QuoteCalculation }
  | { kind: "draft"; quote: QuoteData }
) & { logo?: QuoteDocumentLogo | null };

/** A value shown in the document, or a visible placeholder where a Working Draft is incomplete. */
export type DocumentText = { text: string; missing: boolean };

export type QuoteDocumentLine = {
  number: string;
  description: DocumentText;
  pricing: { kind: "fixed" } | { kind: "quantity"; quantity: DocumentText; unit: DocumentText; unitPrice: DocumentText };
  amount: DocumentText;
};

/** Quote Lines outside any Quote Section form a group without a title or subtotal. */
export type QuoteDocumentGroup = { title: DocumentText | null; subtotal: DocumentText | null; lines: QuoteDocumentLine[] };

export type QuoteDocumentTotal = { label: string; amount: DocumentText; grand: boolean };

export type QuoteDocumentContent = {
  filename: string;
  draft: boolean;
  reference: DocumentText;
  revisionLabel: string | null;
  issueDate: DocumentText;
  validity: string | null;
  title: DocumentText;
  siteAddress: string | null;
  business: { name: DocumentText; address: DocumentText; contact: string; vatId: string | null; logo: string | null };
  customer: { name: DocumentText; address: DocumentText; contact: string };
  terms: string | null;
  groups: QuoteDocumentGroup[];
  totals: QuoteDocumentTotal[];
};

const missingText = "à compléter";

/** Everything a Quote Layout shows, derived from a Published Revision or a Working Draft. */
export function quoteDocumentContent(source: QuoteDocumentSource): QuoteDocumentContent {
  // A Published Revision keeps its stored amounts; only a Working Draft is calculated now.
  const calculation = source.kind === "published" ? source.calculation : calculateQuote(source.quote);
  const quote = source.kind === "draft" && calculation.quote ? calculation.quote : source.quote;
  const reference = filenamePart(quote.reference);
  const suffix = source.kind === "published" ? `r${source.revisionNumber}` : "brouillon";
  return {
    filename: `${["Devis", reference, suffix].filter(Boolean).join("-")}.pdf`,
    draft: source.kind === "draft",
    reference: valueOrMissing(quote.reference),
    issueDate: valueOrMissing(swissDate(quote.issueDate)),
    validity: quote.validUntil.trim() ? `Offre valable jusqu\u2019au ${swissDate(quote.validUntil)}.` : null,
    title: valueOrMissing(quote.title),
    siteAddress: optional(quote.siteAddress),
    business: {
      name: valueOrMissing(quote.businessName),
      address: valueOrMissing(quote.businessAddress),
      contact: quote.businessContact.trim(),
      vatId: quote.vatRegistered === true ? optional(quote.vatId) : null,
      logo: source.logo ? `data:${source.logo.contentType};base64,${Buffer.from(source.logo.data).toString("base64")}` : null,
    },
    customer: { name: valueOrMissing(quote.customerName), address: valueOrMissing(quote.customerAddress), contact: quote.customerContact.trim() },
    terms: optional(quote.terms),
    revisionLabel: source.kind === "published" && source.revisionNumber > 1 ? `Révision ${source.revisionNumber}` : null,
    groups: groupsFor(quote, calculation),
    totals: totalsFor(quote, calculation),
  };
}

function groupsFor(quote: QuoteData, calculation: QuoteCalculation): QuoteDocumentGroup[] {
  const amounts = new Map(calculation.lines.map((line) => [line.id, line.amount]));
  const numbered = new Map(quote.lines.map((line, index) => [line.id, String(index + 1)]));
  const documentLine = (line: QuoteLine): QuoteDocumentLine => ({
    number: numbered.get(line.id)!,
    description: valueOrMissing(line.description),
    pricing: line.mode === "fixed"
      ? { kind: "fixed" }
      : { kind: "quantity", quantity: valueOrMissing(decimal(line.quantity, 0)), unit: valueOrMissing(line.unit), unitPrice: valueOrMissing(decimal(line.unitPrice, 2)) },
    amount: amount(amounts.get(line.id) ?? null),
  });
  const sectionIds = new Set(quote.sections.map((section) => section.id));
  const groups: QuoteDocumentGroup[] = [];
  const ungrouped = quote.lines.filter((line) => line.sectionId === "");
  if (ungrouped.length) groups.push({ title: null, subtotal: null, lines: ungrouped.map(documentLine) });
  for (const section of quote.sections) {
    const result = calculation.sections.find((candidate) => candidate.id === section.id);
    groups.push({
      title: valueOrMissing(section.title),
      subtotal: amount(result && !result.incomplete ? result.subtotal : null),
      lines: quote.lines.filter((line) => line.sectionId === section.id).map(documentLine),
    });
  }
  // Only an invalid Working Draft can reference an unknown Quote Section.
  const unassigned = quote.lines.filter((line) => line.sectionId !== "" && !sectionIds.has(line.sectionId));
  if (unassigned.length) groups.push({ title: null, subtotal: null, lines: unassigned.map(documentLine) });
  return groups;
}

function totalsFor(quote: QuoteData, calculation: QuoteCalculation): QuoteDocumentTotal[] {
  const pricedCompletely = quote.lines.length > 0 && calculation.lines.every((line) => line.amount !== null);
  const totals: QuoteDocumentTotal[] = [{ label: "Sous-total HT", amount: amount(pricedCompletely ? calculation.subtotal : null), grand: false }];
  if (quote.discountMode !== "none") {
    const rate = quote.discountMode === "percent" && quote.discount.trim() ? decimal(quote.discount, 0).replace(".", ",") : "";
    const label = rate ? `Remise ${rate} %` : "Remise";
    totals.push({ label, amount: calculation.discount === null ? amount(null) : { text: `\u2212 ${swissAmount(calculation.discount)}`, missing: false }, grand: false });
    // VAT is charged on the discounted subtotal. Without VAT, that amount is already the total.
    if (quote.vatRegistered !== false) totals.push({ label: "Sous-total apr\u00e8s remise HT", amount: amount(calculation.net), grand: false });
  }
  if (quote.vatRegistered === true) totals.push({ label: "TVA 8,1 %", amount: amount(calculation.vat), grand: false });
  // An unregistered business shows no VAT row. An unanswered VAT status must stay visible in a Working Draft.
  if (quote.vatRegistered === null) totals.push({ label: "TVA", amount: amount(null), grand: false });
  totals.push({ label: "Total CHF", amount: amount(calculation.total), grand: true });
  return totals;
}

/** The value, or the visible placeholder a Working Draft shows where it is still missing. */
function valueOrMissing(value: string): DocumentText {
  return value.trim() ? { text: value.trim(), missing: false } : { text: missingText, missing: true };
}

function optional(value: string): string | null {
  return value.trim() || null;
}

function swissDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function amount(cents: number | null): DocumentText {
  return cents === null ? { text: missingText, missing: true } : { text: swissAmount(cents), missing: false };
}

function swissAmount(cents: number): string {
  return money(cents).replace(/\u202f/g, "\u2019").replace(/\u00a0CHF$/, "");
}

/** Show a decimal with Swiss grouping. Trailing zeros go when places is 0. Values that are not decimals are left as entered. */
function decimal(value: string, places: number): string {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value.trim());
  if (!match) return value;
  const whole = match[1].replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u2019");
  const fraction = places ? (match[2] ?? "").padEnd(places, "0") : (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Keep a reference readable in a filename while dropping accents and path characters. */
function filenamePart(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._]+/g, "-").replace(/^[-.]+|-+$/g, "");
}
