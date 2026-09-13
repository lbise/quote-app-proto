export type QuoteLine = {
  id: string;
  sectionId: string;
  description: string;
  mode: "quantity" | "fixed";
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
};

export type QuoteSection = {
  id: string;
  title: string;
};

export type QuoteData = {
  reference: string;
  title: string;
  customerName: string;
  customerAddress: string;
  customerContact: string;
  businessName: string;
  businessAddress: string;
  businessContact: string;
  vatId: string;
  issueDate: string;
  validUntil: string;
  siteAddress: string;
  terms: string;
  vatRegistered: boolean | null;
  discountMode: "none" | "percent" | "fixed";
  discount: string;
  sections: QuoteSection[];
  lines: QuoteLine[];
};

export type QuoteProblem = { path: string; code: string };

export type QuoteCalculation = {
  quote: QuoteData | null;
  errors: QuoteProblem[];
  missing: QuoteProblem[];
  lines: { id: string; number: number; amount: number | null }[];
  sections: { id: string; subtotal: number; incomplete: boolean }[];
  subtotal: number;
  discount: number | null;
  net: number | null;
  vat: number | null;
  total: number | null;
  complete: boolean;
};

const stringFields = [
  "reference",
  "title",
  "customerName",
  "customerAddress",
  "customerContact",
  "businessName",
  "businessAddress",
  "businessContact",
  "vatId",
  "issueDate",
  "validUntil",
  "siteAddress",
  "terms",
  "discountMode",
  "discount",
] as const;

const lineFields = [
  "id",
  "sectionId",
  "description",
  "mode",
  "quantity",
  "unit",
  "unitPrice",
  "amount",
] as const;

const maxLines = 1_000;
const maxLineCents = 1_000_000_000_000n;
const maxScaledInput = BigInt(Number.MAX_SAFE_INTEGER);

export function emptyQuote(reference: string, defaults: Partial<QuoteData> = {}): QuoteData {
  const blank: QuoteData = {
    reference,
    title: "",
    customerName: "",
    customerAddress: "",
    customerContact: "",
    businessName: "",
    businessAddress: "",
    businessContact: "",
    vatId: "",
    issueDate: "",
    validUntil: "",
    siteAddress: "",
    terms: "",
    vatRegistered: null,
    discountMode: "none",
    discount: "0",
    sections: [],
    lines: [],
  };
  return {
    ...blank,
    ...defaults,
    reference,
    sections: defaults.sections ? [...defaults.sections] : [],
    lines: defaults.lines ? [...defaults.lines] : [],
  };
}

export function calculateQuote(input: unknown): QuoteCalculation {
  const errors: QuoteProblem[] = [];
  const missing: QuoteProblem[] = [];
  const quote = quoteFrom(input, errors);

  if (!quote) return emptyCalculation(errors, missing);

  const error = (path: string, code: string) => addProblem(errors, path, code);
  const absent = (path: string) => addProblem(missing, path, "required");

  for (const field of [
    "reference",
    "title",
    "customerName",
    "customerAddress",
    "businessName",
    "businessAddress",
    "businessContact",
    "issueDate",
  ] as const) {
    if (!quote[field].trim()) absent(field);
  }

  validateDate(quote.issueDate, "issueDate", true, error, absent);
  validateDate(quote.validUntil, "validUntil", false, error, absent);

  if (quote.vatRegistered === null) absent("vatRegistered");
  if (quote.vatRegistered === true && !quote.vatId.trim()) absent("vatId");

  const sectionIds = new Set<string>();
  for (const [index, section] of quote.sections.entries()) {
    const path = `sections[${index}]`;
    if (!section.id.trim()) absent(`${path}.id`);
    else if (sectionIds.has(section.id)) error(`${path}.id`, "duplicate");
    else sectionIds.add(section.id);
    if (!section.title.trim()) absent(`${path}.title`);
  }

  const lineIds = new Set<string>();
  const lineAmounts: (number | null)[] = [];
  for (const [index, line] of quote.lines.entries()) {
    const path = `lines[${index}]`;
    if (!line.id.trim()) absent(`${path}.id`);
    else if (lineIds.has(line.id)) error(`${path}.id`, "duplicate");
    else lineIds.add(line.id);

    if (!line.description.trim()) absent(`${path}.description`);
    if (line.mode !== "quantity" && line.mode !== "fixed") {
      error(`${path}.mode`, "invalid_value");
      lineAmounts.push(null);
      continue;
    }

    const assignedToQuote = line.sectionId === "" || sectionIds.has(line.sectionId);
    if (!assignedToQuote) error(`${path}.sectionId`, "unknown_section");

    const amount = calculatedLineCents(line, path, error, absent);
    lineAmounts.push(assignedToQuote ? amount : null);
  }

  if (quote.lines.length === 0) absent("lines");

  const subtotalValue = lineAmounts.reduce<bigint>((sum, amount) => sum + BigInt(amount ?? 0), 0n);
  const subtotal = toCents(subtotalValue, "subtotal", error) ?? 0;
  const incompletePricing = lineAmounts.some((amount) => amount === null) || quote.lines.length === 0;

  const sections = quote.sections.map((section) => {
    let sectionSubtotal = 0n;
    let incomplete = false;
    quote.lines.forEach((line, index) => {
      if (line.sectionId !== section.id) return;
      const amount = lineAmounts[index];
      if (amount === null) incomplete = true;
      else sectionSubtotal += BigInt(amount);
    });
    return {
      id: section.id,
      subtotal: toCents(sectionSubtotal, `sections.${section.id}.subtotal`, error) ?? 0,
      incomplete,
    };
  });

  const discount = calculateDiscount(quote, subtotalValue, incompletePricing, error, absent);
  const netValue = discount === null ? null : subtotalValue - BigInt(discount);
  const net = netValue === null ? null : toCents(netValue, "net", error);
  const vat = netValue === null || quote.vatRegistered !== true
    ? null
    : toCents(roundHalfUp(netValue * 81n, 1_000n), "vat", error);
  const total = netValue === null || quote.vatRegistered === null
    ? null
    : toCents(netValue + BigInt(vat ?? 0), "total", error);

  const result: QuoteCalculation = {
    quote,
    errors,
    missing,
    lines: quote.lines.map((line, index) => ({ id: line.id, number: index + 1, amount: lineAmounts[index] })),
    sections,
    subtotal,
    discount,
    net,
    vat,
    total,
    complete: false,
  };

  result.complete = errors.length === 0 && missing.length === 0 && !incompletePricing && total !== null;
  return result;
}

export function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("cents must be a safe integer");
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  const fraction = (absolute % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}\u00a0CHF`;
}

function quoteFrom(input: unknown, errors: QuoteProblem[]): QuoteData | null {
  try {
    if (!isRecord(input)) {
      addProblem(errors, "", "invalid_structure");
      return null;
    }
    for (const field of stringFields) {
      if (typeof input[field] !== "string") {
        addProblem(errors, field, "invalid_type");
        return null;
      }
    }
    if (input.vatRegistered !== null && typeof input.vatRegistered !== "boolean") {
      addProblem(errors, "vatRegistered", "invalid_type");
      return null;
    }
    if (!Array.isArray(input.sections) || !Array.isArray(input.lines)) {
      addProblem(errors, "", "invalid_structure");
      return null;
    }
    if (input.sections.length > maxLines || input.lines.length > maxLines) {
      addProblem(errors, "", "out_of_range");
      return null;
    }

    const sections: QuoteSection[] = [];
    for (const [index, section] of input.sections.entries()) {
      if (!isRecord(section) || typeof section.id !== "string" || typeof section.title !== "string") {
        addProblem(errors, `sections[${index}]`, "invalid_structure");
        return null;
      }
      sections.push({ id: section.id, title: section.title });
    }

    const lines: QuoteLine[] = [];
    for (const [index, line] of input.lines.entries()) {
      if (!isRecord(line) || lineFields.some((field) => typeof line[field] !== "string")) {
        addProblem(errors, `lines[${index}]`, "invalid_structure");
        return null;
      }
      const textLine = line as Record<(typeof lineFields)[number], string>;
      lines.push({
        id: textLine.id,
        sectionId: textLine.sectionId,
        description: textLine.description,
        mode: textLine.mode as QuoteLine["mode"],
        quantity: textLine.quantity,
        unit: textLine.unit,
        unitPrice: textLine.unitPrice,
        amount: textLine.amount,
      });
    }

    return {
      ...Object.fromEntries(stringFields.map((field) => [field, input[field]])),
      vatRegistered: input.vatRegistered,
      sections,
      lines: normalizeLines(lines, sections),
    } as QuoteData;
  } catch {
    addProblem(errors, "", "invalid_structure");
    return null;
  }
}

function normalizeLines(lines: QuoteLine[], sections: QuoteSection[]): QuoteLine[] {
  const sectionIds = new Set(sections.map((section) => section.id));
  const ungrouped: QuoteLine[] = [];
  const grouped = new Map<string, QuoteLine[]>();
  const unknown: QuoteLine[] = [];

  for (const line of lines) {
    if (line.sectionId === "") {
      ungrouped.push(line);
    } else if (sectionIds.has(line.sectionId)) {
      const linesInSection = grouped.get(line.sectionId) ?? [];
      linesInSection.push(line);
      grouped.set(line.sectionId, linesInSection);
    } else {
      unknown.push(line);
    }
  }

  const known: QuoteLine[] = [];
  const added = new Set<string>();
  for (const section of sections) {
    if (added.has(section.id)) continue;
    known.push(...(grouped.get(section.id) ?? []));
    added.add(section.id);
  }
  return [...ungrouped, ...known, ...unknown];
}

function calculatedLineCents(
  line: QuoteLine,
  path: string,
  error: (path: string, code: string) => void,
  absent: (path: string) => void,
): number | null {
  const described = Boolean(line.description.trim());
  if (line.mode === "fixed") {
    if (line.quantity.trim()) error(`${path}.quantity`, "inapplicable");
    if (line.unit.trim()) error(`${path}.unit`, "inapplicable");
    if (line.unitPrice.trim()) error(`${path}.unitPrice`, "inapplicable");
    const amount = parseDecimal(line.amount, 2, `${path}.amount`, error, absent);
    return described ? amount : null;
  }
  if (line.mode !== "quantity") return null;

  const quantity = parseDecimal(line.quantity, 3, `${path}.quantity`, error, absent);
  const unitPrice = parseDecimal(line.unitPrice, 2, `${path}.unitPrice`, error, absent);
  if (!line.unit.trim()) absent(`${path}.unit`);
  if (quantity === 0) error(`${path}.quantity`, "must_be_positive");
  if (quantity === null || quantity === 0 || unitPrice === null || !line.unit.trim()) return null;
  const amount = toCents(roundHalfUp(BigInt(quantity) * BigInt(unitPrice), 1_000n), `${path}.amount`, error);
  return described ? amount : null;
}

function calculateDiscount(
  quote: QuoteData,
  subtotal: bigint,
  incompletePricing: boolean,
  error: (path: string, code: string) => void,
  absent: (path: string) => void,
): number | null {
  if (quote.discountMode === "none") return incompletePricing ? null : 0;
  if (quote.discountMode === "percent") {
    const rate = parseDecimal(quote.discount, 2, "discount", error, absent);
    if (rate === null) return null;
    if (rate > 10_000) {
      error("discount", "out_of_range");
      return null;
    }
    return incompletePricing ? null : toCents(roundHalfUp(subtotal * BigInt(rate), 10_000n), "discount", error);
  }
  if (quote.discountMode === "fixed") {
    const fixed = parseDecimal(quote.discount, 2, "discount", error, absent);
    if (fixed === null) return null;
    if (!incompletePricing && BigInt(fixed) > subtotal) {
      error("discount", "out_of_range");
      return null;
    }
    return incompletePricing ? null : fixed;
  }
  error("discountMode", "invalid_value");
  return null;
}

function parseDecimal(
  value: string,
  places: number,
  path: string,
  error: (path: string, code: string) => void,
  absent: (path: string) => void,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    absent(path);
    return null;
  }
  if (trimmed.startsWith("-")) {
    error(path, "negative_value");
    return null;
  }
  const match = /^(\d+)(?:([.,])(\d+))?$/.exec(trimmed);
  if (!match) {
    error(path, "invalid_value");
    return null;
  }
  const fraction = match[3] ?? "";
  if (fraction.length > places) {
    error(path, "unsupported_precision");
    return null;
  }
  const scaled = BigInt(match[1]) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"));
  if (scaled > maxScaledInput) {
    error(path, "out_of_range");
    return null;
  }
  return Number(scaled);
}

function validateDate(
  value: string,
  path: string,
  required: boolean,
  error: (path: string, code: string) => void,
  absent: (path: string) => void,
) {
  if (!value.trim()) {
    if (required) absent(path);
    return;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    error(path, "invalid_value");
    return;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    error(path, "invalid_value");
  }
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function toCents(value: bigint, path: string, error: (path: string, code: string) => void): number | null {
  if (value < 0n || value > maxLineCents) {
    error(path, "out_of_range");
    return null;
  }
  return Number(value);
}

function emptyCalculation(errors: QuoteProblem[], missing: QuoteProblem[]): QuoteCalculation {
  return {
    quote: null,
    errors,
    missing,
    lines: [],
    sections: [],
    subtotal: 0,
    discount: null,
    net: null,
    vat: null,
    total: null,
    complete: false,
  };
}

function addProblem(problems: QuoteProblem[], path: string, code: string) {
  if (!problems.some((problem) => problem.path === path && problem.code === code)) {
    problems.push({ path, code });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
