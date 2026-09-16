import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { calculateQuote, type QuoteData, type QuoteLine } from "./quote";
import { randomUUID } from "./random-id";

export type QuoteToolsResult = {
  quote: QuoteData | null;
  changed: string[];
  capturedLineIds: string[];
  changedFields?: string[];
};

export type CreateQuoteToolsInput = {
  quote: QuoteData;
  capturedLineIds: readonly string[];
  artisanText: string;
  /** Trusted, bounded Artisan-only messages retained by the server. */
  artisanHistory?: readonly string[];
};

const MAX_ARTISAN_TEXT = 8_000;
const MAX_ARTISAN_HISTORY_MESSAGES = 24;
const MAX_ARTISAN_HISTORY_CHARS = 24_000;
const MAX_LINES = 200;
const MAX_DESCRIPTION = 4_000;
const MAX_CUSTOMER_NAME = 300;
const MAX_CUSTOMER_ADDRESS = 1_000;
const MAX_CUSTOMER_CONTACT = 300;
const MAX_UNIT = 100;
const MAX_DECIMAL = 20;
const MAX_EVIDENCE = 8;
const MAX_EVIDENCE_TEXT = 500;
const MAX_WORK_PAYLOAD_BYTES = 40_000;

const emptyParameters = Type.Object({}, { additionalProperties: false });
const evidenceParameters = Type.Array(Type.Object({
  field: StringEnum(["quantity", "unitPrice", "amount"]),
  text: Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_TEXT }),
  sourceLineId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false }), { maxItems: MAX_EVIDENCE });
const lineValueParameters = Type.Object({
  description: Type.String({ minLength: 1, maxLength: MAX_DESCRIPTION }),
  quantity: Type.String({ maxLength: MAX_DECIMAL }),
  unit: Type.String({ maxLength: MAX_UNIT }),
  unitPrice: Type.String({ maxLength: MAX_DECIMAL }),
  amount: Type.String({ maxLength: MAX_DECIMAL }),
}, { additionalProperties: false });
const addLineParameters = Type.Object({
  description: Type.String({ minLength: 1, maxLength: MAX_DESCRIPTION }),
  mode: StringEnum(["quantity", "fixed"]),
  quantity: Type.Optional(Type.String({ maxLength: MAX_DECIMAL })),
  unit: Type.Optional(Type.String({ maxLength: MAX_UNIT })),
  unitPrice: Type.Optional(Type.String({ maxLength: MAX_DECIMAL })),
  amount: Type.Optional(Type.String({ maxLength: MAX_DECIMAL })),
  evidence: Type.Optional(evidenceParameters),
}, { additionalProperties: false });
const supplyLineParameters = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 128 }),
  fields: Type.Partial(lineValueParameters),
  evidence: Type.Optional(evidenceParameters),
}, { additionalProperties: false });
const customerInfoParameters = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CUSTOMER_NAME })),
  address: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CUSTOMER_ADDRESS })),
  contact: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CUSTOMER_CONTACT })),
}, { additionalProperties: false });

type EvidenceField = "quantity" | "unitPrice" | "amount";
type Evidence = { field: EvidenceField; text: string; sourceLineId?: string };
type SuppliableField = "description" | "quantity" | "unit" | "unitPrice" | "amount";
type SuppliedLineFields = Partial<Pick<QuoteLine, SuppliableField>>;
type EvidenceContext = { artisanTexts: readonly string[]; originalLines: ReadonlyMap<string, QuoteLine> };

const suppliableFields = ["description", "quantity", "unit", "unitPrice", "amount"] as const;

export function createQuoteTools(input: CreateQuoteToolsInput): {
  tools: AgentTool[];
  result(): QuoteToolsResult;
} {
  assertInitialInput(input);
  const staged = cloneQuote(input.quote);
  const evidenceContext: EvidenceContext = {
    artisanTexts: [input.artisanText, ...(input.artisanHistory ?? [])],
    originalLines: new Map(staged.lines.map((line) => [line.id, { ...line }])),
  };
  const capturedLineIds = [...new Set(input.capturedLineIds.filter((id) => staged.lines.some((line) => line.id === id)))];
  const changed = new Set<string>();
  const changedFields = new Set<string>();
  let poisoned = false;

  const reject = (): never => {
    poisoned = true;
    throw new Error("Tool input rejected.");
  };

  const mutate = async (signal: AbortSignal | undefined, operation: () => string, kind: "line" | "field" = "line") => {
    if (poisoned || signal?.aborted) reject();
    try {
      const changedId = operation();
      if (calculateQuote(staged).errors.length > 0 || workPayloadBytes(staged) > MAX_WORK_PAYLOAD_BYTES) reject();
      if (kind === "line") changed.add(changedId);
      else changedFields.add(changedId);
      const details = kind === "line" ? { changed: [changedId] } : { changed: [], changedFields: [changedId] };
      return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
    } catch {
      poisoned = true;
      throw new Error("Tool input rejected.");
    }
  };

  const prepare = (validate: (args: unknown) => void) => (args: unknown) => {
    try {
      if (poisoned) reject();
      validate(args);
      return args;
    } catch {
      return reject();
    }
  };

  const readWork: AgentTool = {
    name: "read_work",
    label: "Read work",
    description: "Read the current Quote Lines that this turn may discuss. This does not expose administrative Quote fields.",
    parameters: emptyParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => {
      if (!isExactRecord(args, [])) throw new Error("invalid");
    }),
    execute: async (_toolCallId, params) => {
      if (poisoned || !isExactRecord(params, [])) reject();
      const lines = workLines(staged, capturedLineIds);
      const details = { lines };
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  };

  const setCustomerInfo: AgentTool = {
    name: "set_customer_info",
    label: "Set Customer info",
    description: "Copy Customer name, address, or contact details supplied by the Artisan into this Quote only. Never infer a value and never create or modify a reusable Customer record.",
    parameters: customerInfoParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { customerInfoInput(args, evidenceContext); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const customer = customerInfoInput(params, evidenceContext);
      staged.customerName = customer.name ?? staged.customerName;
      staged.customerAddress = customer.address ?? staged.customerAddress;
      staged.customerContact = customer.contact ?? staged.customerContact;
      return "customer";
    }, "field"),
  };

  const addQuoteLine: AgentTool = {
    name: "add_quote_line",
    label: "Add Quote Line",
    description: "Add one new flat Quote Line. Supply only Artisan-provided commercial facts. Every non-empty quantity, unit price, or fixed amount needs evidence from the current Artisan message, trusted Artisan history, or an exact original Quote Line value.",
    parameters: addLineParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { addLineInput(args, evidenceContext); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const line = addLineInput(params, evidenceContext);
      if (staged.lines.length >= MAX_LINES) reject();
      const id = newLineId(staged);
      staged.lines.push({ id, sectionId: "", ...line });
      capturedLineIds.push(id);
      return id;
    }),
  };

  const supplyMissingLineFields: AgentTool = {
    name: "supply_missing_line_fields",
    label: "Supply missing line fields",
    description: "Supply Artisan-provided values only for empty commercial fields on a captured Quote Line. Do not overwrite, refine, or target manual lines. Quantity-line amounts are calculated and cannot be supplied. Every quantity, unit price, or fixed amount needs evidence from the current Artisan message, trusted Artisan history, or an exact original Quote Line value.",
    parameters: supplyLineParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { suppliedLineFields(args, evidenceContext); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const supplied = suppliedLineFields(params, evidenceContext);
      if (!capturedLineIds.includes(supplied.lineId)) reject();
      const line = staged.lines.find((candidate) => candidate.id === supplied.lineId);
      if (!line) return reject();
      for (const field of suppliableFields) {
        const value = supplied.fields[field];
        if (value === undefined) continue;
        if (line[field] !== "" || (line.mode === "quantity" && field === "amount")) reject();
        if (line.mode === "fixed" && (field === "quantity" || field === "unit" || field === "unitPrice")) reject();
        line[field] = value;
      }
      return line.id;
    }),
  };

  return {
    tools: [readWork, setCustomerInfo, addQuoteLine, supplyMissingLineFields],
    result: () => poisoned
      ? { quote: null, changed: [], capturedLineIds: [] }
      : {
        quote: cloneQuote(staged),
        changed: [...changed],
        capturedLineIds: [...capturedLineIds],
        ...(changedFields.size ? { changedFields: [...changedFields] } : {}),
      },
  };
}

function customerInfoInput(value: unknown, context: EvidenceContext): { name?: string; address?: string; contact?: string } {
  if (!isRecord(value) || !Object.keys(value).length || Object.keys(value).some((key) => !["name", "address", "contact"].includes(key))) {
    throw new Error("invalid");
  }
  const fields = [
    ["name", MAX_CUSTOMER_NAME],
    ["address", MAX_CUSTOMER_ADDRESS],
    ["contact", MAX_CUSTOMER_CONTACT],
  ] as const;
  const result: { name?: string; address?: string; contact?: string } = {};
  for (const [field, maxLength] of fields) {
    if (!Object.hasOwn(value, field)) continue;
    const supplied = value[field];
    if (typeof supplied !== "string" || !supplied.trim() || supplied.length > maxLength || !authoredValueContains(context.artisanTexts, supplied)) {
      throw new Error("invalid");
    }
    result[field] = supplied.trim();
  }
  return result;
}

function authoredValueContains(texts: readonly string[], value: string): boolean {
  const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const normalizedValue = normalize(value);
  return texts.some((text) => normalize(text).includes(normalizedValue));
}

function cloneQuote(quote: QuoteData): QuoteData {
  return {
    ...quote,
    sections: quote.sections.map((section) => ({ ...section })),
    lines: quote.lines.map((line) => ({ ...line })),
  };
}

function assertInitialInput(input: CreateQuoteToolsInput) {
  if (typeof input.artisanText !== "string" || input.artisanText.length > MAX_ARTISAN_TEXT || !Array.isArray(input.capturedLineIds)
    || (input.artisanHistory !== undefined && (!Array.isArray(input.artisanHistory)
      || input.artisanHistory.length > MAX_ARTISAN_HISTORY_MESSAGES
      || input.artisanHistory.some((text) => typeof text !== "string" || text.length > MAX_ARTISAN_TEXT)
      || input.artisanHistory.reduce((total, text) => total + text.length, 0) > MAX_ARTISAN_HISTORY_CHARS))) {
    throw new Error("Tool input rejected.");
  }
  const calculation = calculateQuote(input.quote);
  if (!calculation.quote || calculation.errors.length || input.quote.lines.length > MAX_LINES || workPayloadBytes(input.quote) > MAX_WORK_PAYLOAD_BYTES) {
    throw new Error("Tool input rejected.");
  }
}

function workLines(quote: QuoteData, capturedLineIds: readonly string[]) {
  return quote.lines.map((line) => ({
    id: line.id,
    description: line.description,
    mode: line.mode,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    amount: line.amount,
    canSupplyMissingFields: capturedLineIds.includes(line.id),
  }));
}

function workPayloadBytes(quote: QuoteData): number {
  return new TextEncoder().encode(JSON.stringify({ lines: workLines(quote, []) })).byteLength;
}

function newLineId(quote: QuoteData): string {
  const ids = new Set(quote.lines.map((line) => line.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomUUID();
    if (!ids.has(id)) return id;
  }
  throw new Error("invalid");
}

function addLineInput(value: unknown, evidenceContext: EvidenceContext): Omit<QuoteLine, "id" | "sectionId"> {
  const keys = ["description", "mode", "quantity", "unit", "unitPrice", "amount", "evidence"];
  if (!isRecord(value) || !Object.hasOwn(value, "description") || !Object.hasOwn(value, "mode")
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("invalid");
  }
  const description = value.description;
  const mode = value.mode;
  const quantity = value.quantity ?? "";
  const unit = value.unit ?? "";
  const unitPrice = value.unitPrice ?? "";
  const amount = value.amount ?? "";
  if (typeof description !== "string" || !description.trim() || description.length > MAX_DESCRIPTION
    || (mode !== "quantity" && mode !== "fixed")
    || typeof quantity !== "string" || quantity.length > MAX_DECIMAL
    || typeof unit !== "string" || unit.length > MAX_UNIT
    || typeof unitPrice !== "string" || unitPrice.length > MAX_DECIMAL
    || typeof amount !== "string" || amount.length > MAX_DECIMAL) {
    throw new Error("invalid");
  }
  if ((mode === "quantity" && amount !== "") || (mode === "fixed" && (quantity !== "" || unit !== "" || unitPrice !== ""))) {
    throw new Error("invalid");
  }
  assertEvidence(value.evidence ?? [], evidenceContext, { quantity, unitPrice, amount });
  return { description, mode, quantity, unit, unitPrice, amount };
}

function suppliedLineFields(value: unknown, evidenceContext: EvidenceContext): {
  lineId: string;
  fields: SuppliedLineFields;
} {
  if (!isRecord(value) || !Object.hasOwn(value, "lineId") || !Object.hasOwn(value, "fields")
    || Object.keys(value).some((key) => !["lineId", "fields", "evidence"].includes(key))
    || typeof value.lineId !== "string" || !value.lineId || value.lineId.length > 128
    || !isRecord(value.fields)) {
    throw new Error("invalid");
  }
  const fields = value.fields;
  const keys = Object.keys(fields);
  if (!keys.length || keys.some((key) => !suppliableFields.includes(key as SuppliableField))) {
    throw new Error("invalid");
  }
  const result: SuppliedLineFields = {};
  for (const field of suppliableFields) {
    if (!Object.hasOwn(fields, field)) continue;
    const supplied = fields[field];
    const maxLength = field === "description" ? MAX_DESCRIPTION : field === "unit" ? MAX_UNIT : MAX_DECIMAL;
    if (typeof supplied !== "string" || !supplied.trim() || supplied.length > maxLength) throw new Error("invalid");
    result[field] = supplied;
  }
  assertEvidence(value.evidence ?? [], evidenceContext, {
    quantity: result.quantity ?? "",
    unitPrice: result.unitPrice ?? "",
    amount: result.amount ?? "",
  });
  return { lineId: value.lineId, fields: result };
}

function assertEvidence(value: unknown, context: EvidenceContext, supplied: Record<EvidenceField, string>) {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE) throw new Error("invalid");
  const evidence: Evidence[] = value.map((item) => {
    const keys = Object.hasOwn(item ?? {}, "sourceLineId") ? ["field", "text", "sourceLineId"] : ["field", "text"];
    if (!isExactRecord(item, keys)
      || (item.field !== "quantity" && item.field !== "unitPrice" && item.field !== "amount")
      || typeof item.text !== "string" || !item.text || item.text.length > MAX_EVIDENCE_TEXT
      || (item.sourceLineId !== undefined && (typeof item.sourceLineId !== "string" || !item.sourceLineId || item.sourceLineId.length > 128))) {
      throw new Error("invalid");
    }
    return { field: item.field, text: item.text, ...(item.sourceLineId === undefined ? {} : { sourceLineId: item.sourceLineId }) };
  });
  if (new Set(evidence.map((item) => item.field)).size !== evidence.length) throw new Error("invalid");
  for (const field of ["quantity", "unitPrice", "amount"] as const) {
    const suppliedValue = supplied[field];
    const matchingEvidence = evidence.find((item) => item.field === field);
    if (!suppliedValue) {
      if (matchingEvidence) throw new Error("invalid");
      continue;
    }
    if (!matchingEvidence || !numericEvidenceMatches(suppliedValue, matchingEvidence.text)) throw new Error("invalid");
    if (matchingEvidence.sourceLineId !== undefined) {
      const sourceLine = context.originalLines.get(matchingEvidence.sourceLineId);
      if (!sourceLine || normalizedDecimal(sourceLine[field]) !== normalizedDecimal(suppliedValue)) throw new Error("invalid");
    } else if (!context.artisanTexts.some((text) => text.includes(matchingEvidence.text) && numericEvidenceMatches(suppliedValue, text))) {
      throw new Error("invalid");
    }
  }
}

function numericEvidenceMatches(value: string, evidence: string): boolean {
  const expected = normalizedDecimal(value);
  return expected !== undefined && [...standaloneNumbers(evidence)].some((candidate) => normalizedDecimal(candidate) === expected);
}

function* standaloneNumbers(text: string): Iterable<string> {
  const pattern = /(?<![\p{L}\p{N}_.,'’−-])\d+(?:[.,]\d+)?(?![\p{L}\p{N}_'’]|[.,]\d)/gu;
  for (const match of text.matchAll(pattern)) yield match[0];
}

function normalizedDecimal(value: string): string | undefined {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value);
  if (!match) return undefined;
  const whole = BigInt(match[1]).toString();
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
