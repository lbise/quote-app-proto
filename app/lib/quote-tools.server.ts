import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { appendQuoteLineToSection, calculateQuote, type QuoteData, type QuoteLine } from "./quote";
import { randomUUID } from "./random-id";

export type CopyFact = {
  lineId: string;
  mode: QuoteLine["mode"];
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  quantityUnknown: boolean;
};

export type QuoteToolsResult = {
  quote: QuoteData | null;
  changed: string[];
  capturedLineIds: string[];
  changedFields?: string[];
  copyFacts?: CopyFact[];
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
  sectionId: Type.Optional(Type.String({ maxLength: 128 })),
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
const linePatchParameters = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 128 }),
  fields: Type.Object({
    description: Type.Optional(Type.String({ maxLength: MAX_DESCRIPTION })),
    quantity: Type.Optional(Type.String({ maxLength: MAX_DECIMAL })),
    unit: Type.Optional(Type.String({ maxLength: MAX_UNIT })),
    unitPrice: Type.Optional(Type.String({ maxLength: MAX_DECIMAL })),
    amount: Type.Optional(Type.String({ maxLength: MAX_DECIMAL })),
  }, { minProperties: 1, additionalProperties: false }),
  clearFields: Type.Optional(Type.Array(StringEnum(["quantity", "unitPrice", "amount"]), { maxItems: 3, uniqueItems: true })),
  evidence: Type.Optional(evidenceParameters),
}, { additionalProperties: false });
const sectionTitleParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: MAX_DESCRIPTION }),
}, { additionalProperties: false });
const sectionIdParameters = Type.Object({
  sectionId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
const moveLineParameters = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 128 }),
  sectionId: Type.String({ maxLength: 128 }),
}, { additionalProperties: false });
const duplicateLineParameters = Type.Object({
  lineId: Type.String({ minLength: 1, maxLength: 128 }),
  sectionId: Type.Optional(Type.String({ maxLength: 128 })),
  measurementPolicy: Type.Optional(StringEnum(["retain", "unknown"])),
}, { additionalProperties: false });
const duplicateSectionParameters = Type.Object({
  sectionId: Type.String({ minLength: 1, maxLength: 128 }),
  measurementPolicy: Type.Optional(StringEnum(["retain", "unknown"])),
}, { additionalProperties: false });

type EvidenceField = "quantity" | "unitPrice" | "amount";
type Evidence = { field: EvidenceField; text: string; sourceLineId?: string };
type SuppliableField = "description" | "quantity" | "unit" | "unitPrice" | "amount";
type SuppliedLineFields = Partial<Pick<QuoteLine, SuppliableField>>;
type EvidenceContext = { artisanTexts: readonly string[]; originalLines: ReadonlyMap<string, QuoteLine> };
type Mutation = { changed?: string[]; changedFields?: string[] };

const suppliableFields = ["description", "quantity", "unit", "unitPrice", "amount"] as const;
const patchableFields = suppliableFields;

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
  const copyFacts: CopyFact[] = [];
  let poisoned = false;

  const reject = (): never => {
    poisoned = true;
    throw new Error("Tool input rejected.");
  };

  const mutate = async (signal: AbortSignal | undefined, operation: () => Mutation) => {
    if (poisoned || signal?.aborted) reject();
    try {
      const mutation = operation();
      if (calculateQuote(staged).errors.length > 0 || workPayloadBytes(staged) > MAX_WORK_PAYLOAD_BYTES) reject();
      for (const id of mutation.changed ?? []) changed.add(id);
      for (const field of mutation.changedFields ?? []) changedFields.add(field);
      const details = { changed: mutation.changed ?? [], changedFields: mutation.changedFields ?? [] };
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
      const details = {
        sections: staged.sections.map((section, index) => ({ id: section.id, title: section.title, number: index + 1 })),
        lines,
      };
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
      const before = [staged.customerName, staged.customerAddress, staged.customerContact].join("\u0000");
      staged.customerName = customer.name ?? staged.customerName;
      staged.customerAddress = customer.address ?? staged.customerAddress;
      staged.customerContact = customer.contact ?? staged.customerContact;
      return before === [staged.customerName, staged.customerAddress, staged.customerContact].join("\u0000") ? {} : { changedFields: ["customer"] };
    }),
  };

  const addQuoteLine: AgentTool = {
    name: "add_quote_line",
    label: "Add Quote Line",
    description: "Add one new Quote Line, optionally to an existing section. Supply only Artisan-provided commercial facts. Every non-empty quantity, unit price, or fixed amount needs evidence from the current Artisan message, trusted Artisan history, or an exact original Quote Line value.",
    parameters: addLineParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { addLineInput(args, evidenceContext); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const line = addLineInput(params, evidenceContext);
      if (line.sectionId !== "" && !staged.sections.some((section) => section.id === line.sectionId)) reject();
      if (staged.lines.length >= MAX_LINES) reject();
      const id = newLineId(staged);
      staged.lines.push({ id, ...line });
      capturedLineIds.push(id);
      return { changed: [id] };
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
      return { changed: [line.id] };
    }),
  };

  const updateQuoteLine: AgentTool = {
    name: "update_quote_line",
    label: "Update Quote Line",
    description: "Correct one existing Quote Line. Use a stable line ID from read_work. Numeric corrections require evidence from the Artisan; never invent a price or measurement.",
    parameters: linePatchParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { linePatchInput(args, evidenceContext); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const patch = linePatchInput(params, evidenceContext);
      const line = staged.lines.find((candidate) => candidate.id === patch.lineId);
      if (!line) reject();
      const before = { ...line };
      applyLinePatch(line!, patch.fields);
      return JSON.stringify(before) === JSON.stringify(line) ? {} : { changed: [line!.id] };
    }),
  };

  const createQuoteSection: AgentTool = {
    name: "create_quote_section",
    label: "Create Quote Section",
    description: "Create a new French-named Quote Section. Section IDs are generated by the application.",
    parameters: sectionTitleParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { sectionTitleInput(args); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const { title } = sectionTitleInput(params);
      if (staged.sections.length >= MAX_LINES) reject();
      const id = newSectionId(staged);
      staged.sections.push({ id, title });
      return { changedFields: [`section:${id}`] };
    }),
  };

  const renameQuoteSection: AgentTool = {
    name: "rename_quote_section",
    label: "Rename Quote Section",
    description: "Rename one existing Quote Section using its stable section ID.",
    parameters: Type.Object({ ...sectionIdParameters.properties, title: Type.String({ minLength: 1, maxLength: MAX_DESCRIPTION }) }, { additionalProperties: false }),
    executionMode: "sequential",
    prepareArguments: prepare((args) => { renameSectionInput(args); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const { sectionId, title } = renameSectionInput(params);
      const section = staged.sections.find((candidate) => candidate.id === sectionId);
      if (!section) reject();
      if (section!.title === title) return {};
      section!.title = title;
      return { changedFields: [`section:${sectionId}`] };
    }),
  };

  const moveQuoteLine: AgentTool = {
    name: "move_quote_line",
    label: "Move Quote Line",
    description: "Move an existing Quote Line to a section or No section. Moving appends it to the destination group.",
    parameters: moveLineParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { moveLineInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const { lineId, sectionId } = moveLineInput(params, staged);
      const line = staged.lines.find((candidate) => candidate.id === lineId)!;
      if (line.sectionId === sectionId) return {};
      staged.lines = appendQuoteLineToSection(staged.lines, { ...line, sectionId }, staged.sections);
      return { changed: [lineId] };
    }),
  };

  const duplicateQuoteLine: AgentTool = {
    name: "duplicate_quote_line",
    label: "Duplicate Quote Line",
    description: "Duplicate one existing Quote Line with a fresh application ID. Copy values from the source; when measurements are unknown, use measurementPolicy unknown.",
    parameters: duplicateLineParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { duplicateLineInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const input = duplicateLineInput(params, staged);
      if (staged.lines.length >= MAX_LINES) reject();
      const source = staged.lines.find((candidate) => candidate.id === input.lineId)!;
      const unknownMeasurements = input.measurementPolicy === "unknown";
      const copy = copyLine(source, newLineId(staged), input.sectionId ?? source.sectionId, unknownMeasurements);
      staged.lines = insertAfterSource(staged.lines, source.id, copy, staged.sections);
      copyFacts.push(copyFact(copy, unknownMeasurements));
      return { changed: [copy.id] };
    }),
  };

  const duplicateQuoteSection: AgentTool = {
    name: "duplicate_quote_section",
    label: "Duplicate Quote Section",
    description: "Duplicate a Quote Section and all its contained work with fresh application IDs. Use measurementPolicy unknown when copied quantities are not known.",
    parameters: duplicateSectionParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { duplicateSectionInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const input = duplicateSectionInput(params, staged);
      if (staged.sections.length >= MAX_LINES || staged.lines.length + staged.lines.filter((line) => line.sectionId === input.sectionId).length > MAX_LINES) reject();
      const source = staged.sections.find((candidate) => candidate.id === input.sectionId)!;
      const id = newSectionId(staged);
      const copy = { ...source, id, title: `${source.title} copie` };
      const sourceLines = staged.lines.filter((line) => line.sectionId === source.id);
      // IDs are generated against the growing set, including earlier copies.
      const unknownMeasurements = input.measurementPolicy === "unknown";
      const uniqueCopies = sourceLines.reduce<QuoteLine[]>((result, line) => {
        const copied = copyLine(line, newLineId({ ...staged, lines: [...staged.lines, ...result] }), id, unknownMeasurements);
        copyFacts.push(copyFact(copied, unknownMeasurements));
        result.push(copied);
        return result;
      }, []);
      const sectionIndex = staged.sections.findIndex((candidate) => candidate.id === source.id);
      staged.sections.splice(sectionIndex + 1, 0, copy);
      staged.lines = groupedWithSections(staged.lines.concat(uniqueCopies), staged.sections);
      return { changed: uniqueCopies.map((line) => line.id), changedFields: [`section:${id}`] };
    }),
  };

  return {
    tools: [readWork, setCustomerInfo, addQuoteLine, supplyMissingLineFields, updateQuoteLine, createQuoteSection, renameQuoteSection, moveQuoteLine, duplicateQuoteLine, duplicateQuoteSection],
    result: () => poisoned
      ? { quote: null, changed: [], capturedLineIds: [] }
      : {
        quote: cloneQuote(staged),
        changed: [...changed],
        capturedLineIds: [...capturedLineIds],
        ...(changedFields.size ? { changedFields: [...changedFields] } : {}),
        ...(copyFacts.length ? {
          copyFacts: copyFacts.map((fact) => {
            const line = staged.lines.find((candidate) => candidate.id === fact.lineId);
            return line ? copyFact(line, fact.quantityUnknown) : { ...fact };
          }),
        } : {}),
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
  if (!calculation.quote || calculation.errors.length || input.quote.lines.length > MAX_LINES || input.quote.sections.length > MAX_LINES || workPayloadBytes(input.quote) > MAX_WORK_PAYLOAD_BYTES) {
    throw new Error("Tool input rejected.");
  }
}

function workLines(quote: QuoteData, capturedLineIds: readonly string[]) {
  return quote.lines.map((line, index) => ({
    number: index + 1,
    id: line.id,
    sectionId: line.sectionId,
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
  return new TextEncoder().encode(JSON.stringify({
    sections: quote.sections.map((section, index) => ({ id: section.id, title: section.title, number: index + 1 })),
    lines: workLines(quote, []),
  })).byteLength;
}

function newLineId(quote: QuoteData): string {
  const ids = new Set(quote.lines.map((line) => line.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomUUID();
    if (!ids.has(id)) return id;
  }
  throw new Error("invalid");
}

function addLineInput(value: unknown, evidenceContext: EvidenceContext): Omit<QuoteLine, "id"> {
  const keys = ["description", "mode", "quantity", "unit", "unitPrice", "amount", "sectionId", "evidence"];
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
  const sectionId = value.sectionId ?? "";
  if (typeof sectionId !== "string" || sectionId.length > 128) throw new Error("invalid");
  if ((mode === "quantity" && amount !== "") || (mode === "fixed" && (quantity !== "" || unit !== "" || unitPrice !== ""))) {
    throw new Error("invalid");
  }
  assertEvidence(value.evidence ?? [], evidenceContext, { quantity, unitPrice, amount });
  return { description, mode, quantity, unit, unitPrice, amount, sectionId };
}

function linePatchInput(value: unknown, evidenceContext: EvidenceContext): { lineId: string; fields: SuppliedLineFields } {
  if (!isRecord(value) || !Object.hasOwn(value, "lineId") || !Object.hasOwn(value, "fields")
    || Object.keys(value).some((key) => !["lineId", "fields", "clearFields", "evidence"].includes(key))
    || typeof value.lineId !== "string" || !value.lineId || value.lineId.length > 128 || !isRecord(value.fields)) {
    throw new Error("invalid");
  }
  const fields = value.fields;
  const keys = Object.keys(fields);
  if (!keys.length || keys.some((key) => !patchableFields.includes(key as SuppliableField))) throw new Error("invalid");
  const clearFields = value.clearFields ?? [];
  if (!Array.isArray(clearFields) || clearFields.some((field) => !["quantity", "unitPrice", "amount"].includes(field as string))
    || new Set(clearFields).size !== clearFields.length) throw new Error("invalid");
  const result: SuppliedLineFields = {};
  for (const field of patchableFields) {
    if (!Object.hasOwn(fields, field)) continue;
    const supplied = fields[field];
    const maxLength = field === "description" ? MAX_DESCRIPTION : field === "unit" ? MAX_UNIT : MAX_DECIMAL;
    if (typeof supplied !== "string" || supplied.length > maxLength || (field === "description" && !supplied.trim())
      || (supplied === "" && field !== "unit" && !clearFields.includes(field))
      || (supplied !== "" && (field === "description" || field === "unit")
        && !authoredValueContains(evidenceContext.artisanTexts, supplied)
        && ![...evidenceContext.originalLines.values()].some((line) => line[field] === supplied))) throw new Error("invalid");
    result[field] = supplied;
  }
  if (clearFields.some((field) => !Object.hasOwn(fields, field) || fields[field] !== "" || !explicitlyUnknown(evidenceContext.artisanTexts, field))) throw new Error("invalid");
  assertEvidence(value.evidence ?? [], evidenceContext, {
    quantity: result.quantity ?? "",
    unitPrice: result.unitPrice ?? "",
    amount: result.amount ?? "",
  });
  return { lineId: value.lineId, fields: result };
}

function explicitlyUnknown(texts: readonly string[], field: "quantity" | "unitPrice" | "amount"): boolean {
  const text = texts.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const unknown = /\b(?:unknown|inconnu|inconnue|inconnus|inconnues|ne connais pas|ne sait pas|a confirmer|à confirmer|to confirm|clear|efface|supprime|vider|vide)\b/.test(text)
    || /\b(?:sans|without)\s+(?:mesure|mesures|surface|area|size|taille|quantité|quantite|measurement|measurements|prix|price|cost|coût|cout|montant|amount)\b/.test(text);
  const subject = field === "quantity"
    ? /\b(?:measurement|measurements|mesure|mesures|surface|area|size|taille|quantit|dimension|dimensions)\b/.test(text)
    : /\b(?:price|prices|prix|cost|coût|cout|montant|amount|tarif|rate|taux)\b/.test(text);
  return unknown && subject;
}

function copyFact(line: QuoteLine, quantityUnknown: boolean): CopyFact {
  return {
    lineId: line.id,
    mode: line.mode,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    amount: line.amount,
    quantityUnknown,
  };
}

function applyLinePatch(line: QuoteLine, fields: SuppliedLineFields) {
  if (line.mode === "fixed" && ["quantity", "unit", "unitPrice"].some((field) => Object.hasOwn(fields, field))) throw new Error("invalid");
  if (line.mode === "quantity" && Object.hasOwn(fields, "amount")) throw new Error("invalid");
  for (const field of patchableFields) {
    if (Object.hasOwn(fields, field)) line[field] = fields[field]!;
  }
}

function sectionTitleInput(value: unknown): { title: string } {
  if (!isExactRecord(value, ["title"]) || typeof value.title !== "string" || !value.title.trim() || value.title.length > MAX_DESCRIPTION) throw new Error("invalid");
  return { title: value.title.trim() };
}

function renameSectionInput(value: unknown): { sectionId: string; title: string } {
  if (!isRecord(value) || !isExactRecord(value, ["sectionId", "title"])
    || typeof value.sectionId !== "string" || !value.sectionId || value.sectionId.length > 128) throw new Error("invalid");
  return { sectionId: value.sectionId, title: sectionTitleInput({ title: value.title }).title };
}

function moveLineInput(value: unknown, quote: QuoteData): { lineId: string; sectionId: string } {
  if (!isExactRecord(value, ["lineId", "sectionId"]) || typeof value.lineId !== "string" || !value.lineId
    || typeof value.sectionId !== "string" || value.sectionId.length > 128
    || !quote.lines.some((line) => line.id === value.lineId)
    || (value.sectionId !== "" && !quote.sections.some((section) => section.id === value.sectionId))) throw new Error("invalid");
  return { lineId: value.lineId, sectionId: value.sectionId };
}

function duplicateLineInput(value: unknown, quote: QuoteData): { lineId: string; sectionId?: string; measurementPolicy: "retain" | "unknown" } {
  if (!isRecord(value) || Object.keys(value).some((key) => !["lineId", "sectionId", "measurementPolicy"].includes(key))
    || typeof value.lineId !== "string" || !value.lineId || !quote.lines.some((line) => line.id === value.lineId)
    || (value.sectionId !== undefined && (typeof value.sectionId !== "string" || value.sectionId.length > 128
      || (value.sectionId !== "" && !quote.sections.some((section) => section.id === value.sectionId))))) throw new Error("invalid");
  if (value.measurementPolicy !== undefined && value.measurementPolicy !== "retain" && value.measurementPolicy !== "unknown") throw new Error("invalid");
  return { lineId: value.lineId, ...(value.sectionId === undefined ? {} : { sectionId: value.sectionId }), measurementPolicy: value.measurementPolicy ?? "retain" };
}

function duplicateSectionInput(value: unknown, quote: QuoteData): { sectionId: string; measurementPolicy: "retain" | "unknown" } {
  if (!isRecord(value) || Object.keys(value).some((key) => !["sectionId", "measurementPolicy"].includes(key))
    || typeof value.sectionId !== "string" || !value.sectionId || !quote.sections.some((section) => section.id === value.sectionId)) throw new Error("invalid");
  if (value.measurementPolicy !== undefined && value.measurementPolicy !== "retain" && value.measurementPolicy !== "unknown") throw new Error("invalid");
  return { sectionId: value.sectionId, measurementPolicy: value.measurementPolicy ?? "retain" };
}

function newSectionId(quote: QuoteData): string {
  const ids = new Set(quote.sections.map((section) => section.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = `section-${randomUUID()}`;
    if (!ids.has(id)) return id;
  }
  throw new Error("invalid");
}

function insertAfterSource(lines: QuoteLine[], sourceId: string, copy: QuoteLine, sections: { id: string }[]): QuoteLine[] {
  const source = lines.find((line) => line.id === sourceId)!;
  if (copy.sectionId === source.sectionId) {
    const result = [...lines];
    result.splice(result.findIndex((line) => line.id === sourceId) + 1, 0, copy);
    return result;
  }
  return appendQuoteLineToSection(lines, copy, sections);
}

function groupedWithSections(lines: QuoteLine[], sections: { id: string }[]): QuoteLine[] {
  return [
    ...lines.filter((line) => line.sectionId === ""),
    ...sections.flatMap((section) => lines.filter((line) => line.sectionId === section.id)),
    ...lines.filter((line) => line.sectionId !== "" && !sections.some((section) => section.id === line.sectionId)),
  ];
}

function copyLine(source: QuoteLine, id: string, sectionId: string, unknownMeasurements: boolean): QuoteLine {
  const copy = { ...source, id, sectionId };
  if (unknownMeasurements && source.mode === "quantity") {
    copy.quantity = "";
    copy.amount = "";
    copy.description = withoutMeasurement(copy.description);
  }
  return copy;
}

function withoutMeasurement(description: string): string {
  return description
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:[x×/]\s*\d+(?:[.,]\d+)?)+(?:\s*(?:m|cm|mm))?\b/giu, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:m²|m2|cm|mm|km|m|kg|g|l|cl|ml|h|heures?|jours?|pce|pièces?|mètres? carrés?|metres? carres?|mètres? cubes?|metres? cubes?|square meters?|square metres?|cubic meters?|cubic metres?|sq\.?\s*m|pieds?|feet|litres?|liters?|kilogrammes?|kilograms?)\b/giu, "")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/([(:])\s+/g, "$1").trim();
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
