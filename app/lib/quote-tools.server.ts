import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { editQuoteLinesParameters } from "../../docs/assistant-contract/edit-quote-lines";
import { appendQuoteLineToSection, calculateQuote, type QuoteData, type QuoteLine } from "./quote";
import { MAX_QUOTE_LINES, MAX_QUOTE_SECTIONS, quoteDraftLimit } from "./quote-limits";
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

export type QuoteToolsDiagnostic = { phase: "tool"; code: string; tool?: string };

class ToolValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type CreateQuoteToolsInput = {
  quote: QuoteData;
  capturedLineIds: readonly string[];
  artisanText: string;
  /** Trusted, bounded Artisan-only messages retained by the server. */
  artisanHistory?: readonly string[];
  /** The application-visible IDs for retained Artisan messages. */
  artisanHistorySources?: readonly { source: string; text: string }[];
  /** A published Quote's reference cannot be changed. */
  referenceLocked?: boolean;
  /** Optional runner-owned preflight for the next application context. */
  validateStaged?: (quote: QuoteData) => string | undefined;
};

const MAX_ARTISAN_TEXT = 8_000;
const MAX_ARTISAN_HISTORY_MESSAGES = 24;
const MAX_ARTISAN_HISTORY_CHARS = 24_000;
const MAX_DETAIL_TEXT = 20_000;
const MAX_LINE_DESCRIPTION = 20_000;
const MAX_SECTION_TITLE = 4_000;
const MAX_UNIT = 100;
const MAX_DECIMAL = 20;
const MAX_EVIDENCE = 200;
const MAX_EVIDENCE_FIELDS = 200;
const MAX_EVIDENCE_TEXT = 2_000;
const MAX_EVIDENCE_SOURCE = 256;
const MAX_EVIDENCE_FIELD = 160;

const evidenceCitationParameters = Type.Object({
  fields: Type.Array(Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_FIELD }), {
    minItems: 1, maxItems: MAX_EVIDENCE_FIELDS, uniqueItems: true,
    description: "Fields supported by this citation. For edit_quote_details, use field names such as discountMode and discount. For other tools, use JSON Pointers such as /sections/0/title.",
  }),
  source: Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_SOURCE, description: "Source supplied by the application: current, history_N, quote.FIELD, line:ID.FIELD or section:ID.FIELD. Never cite an assistant message." }),
  text: Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_TEXT, description: "Exact excerpt from the identified source. One citation may support several fields." }),
}, { additionalProperties: false });

const editQuoteDetailsParameters = Type.Object({
  fields: Type.Object({
    reference: Type.Optional(Type.String({ maxLength: 200 })),
    title: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    issueDate: Type.Optional(Type.String({ maxLength: 10, description: "YYYY-MM-DD or empty." })),
    validUntil: Type.Optional(Type.String({ maxLength: 10, description: "YYYY-MM-DD or empty." })),
    siteAddress: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    customerName: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    customerAddress: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    customerContact: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    businessName: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    businessAddress: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    businessContact: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    terms: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    vatRegistered: Type.Optional(Type.Union([Type.Boolean(), Type.Null()], { description: "True applies the supported standard VAT treatment, false means not registered, null means unknown. Never infer registration." })),
    vatId: Type.Optional(Type.String({ maxLength: MAX_DETAIL_TEXT })),
    discountMode: Type.Optional(StringEnum(["none", "percent", "fixed"])),
    discount: Type.Optional(Type.String({ maxLength: MAX_DECIMAL, pattern: "^$|^[0-9]+([.,][0-9]+)?$", description: "Decimal without units, or the empty string to deliberately clear the value. Missing is not zero." })),
  }, { additionalProperties: false, minProperties: 1 }),
  evidence: Type.Optional(Type.Array(evidenceCitationParameters, { minItems: 1, maxItems: MAX_EVIDENCE, description: "Cite sources for new nonempty commercial facts. Omit for deliberate clearing or unchanged values." })),
}, { additionalProperties: false });

const sectionTitleParameters = Type.Object({ title: Type.String({ minLength: 1, maxLength: MAX_SECTION_TITLE }) }, { additionalProperties: false });
const sectionIdParameters = Type.Object({ sectionId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
const moveLineParameters = Type.Object({ lineId: Type.String({ minLength: 1, maxLength: 128 }), sectionId: Type.String({ maxLength: 128 }) }, { additionalProperties: false });
const duplicateLineParameters = Type.Object({ lineId: Type.String({ minLength: 1, maxLength: 128 }), sectionId: Type.Optional(Type.String({ maxLength: 128 })), measurementPolicy: Type.Optional(StringEnum(["retain", "unknown"])) }, { additionalProperties: false });
const duplicateSectionParameters = Type.Object({ sectionId: Type.String({ minLength: 1, maxLength: 128 }), measurementPolicy: Type.Optional(StringEnum(["retain", "unknown"])) }, { additionalProperties: false });

const detailTextFields = ["reference", "title", "issueDate", "validUntil", "siteAddress", "customerName", "customerAddress", "customerContact", "businessName", "businessAddress", "businessContact", "terms", "vatId", "discount"] as const;
const detailFields = [...detailTextFields, "vatRegistered", "discountMode"] as const;
type DetailField = (typeof detailFields)[number];
type EvidenceCitation = { fields: string[]; source: string; text: string };
type EvidenceContext = {
  artisanText: string;
  artisanHistory: readonly { source: string; text: string }[];
  originalQuote: QuoteData;
  originalLines: ReadonlyMap<string, QuoteLine>;
  originalSections: ReadonlyMap<string, { id: string; title: string }>;
};
type Mutation = { changed?: string[]; changedFields?: string[] };
type EditableLine = Omit<QuoteLine, "id" | "sectionId"> & { id?: string; sectionId?: string };

export function createQuoteTools(input: CreateQuoteToolsInput): {
  tools: AgentTool[];
  result(): QuoteToolsResult;
  diagnostic(): QuoteToolsDiagnostic | undefined;
} {
  assertInitialInput(input);
  const staged = cloneQuote(input.quote);
  const originalQuote = cloneQuote(input.quote);
  const evidenceContext: EvidenceContext = {
    artisanText: input.artisanText,
    artisanHistory: input.artisanHistorySources ?? (input.artisanHistory ?? []).map((text, index) => ({ source: `history_${index + 1}`, text })),
    originalQuote,
    originalLines: new Map(originalQuote.lines.map((line) => [line.id, { ...line }])),
    originalSections: new Map(originalQuote.sections.map((section) => [section.id, { ...section }])),
  };
  const capturedLineIds = [...new Set(input.capturedLineIds.filter((id) => staged.lines.some((line) => line.id === id)))];
  const changed = new Set<string>();
  const changedFields = new Set<string>();
  const copyFacts: CopyFact[] = [];
  let lastErrorCode: string | undefined;

  const reject = (code = "invalid_tool_input"): never => {
    lastErrorCode = code;
    throw new Error(toolErrorMessage(code));
  };

  const mutate = async (signal: AbortSignal | undefined, operation: () => Mutation) => {
    if (signal?.aborted) reject("tool_aborted");
    const before = cloneQuote(staged);
    const changedBefore = new Set(changed);
    const changedFieldsBefore = new Set(changedFields);
    const copyFactsBefore = copyFacts.length;
    const capturedBefore = [...capturedLineIds];
    try {
      const mutation = operation();
      if (calculateQuote(staged).errors.length > 0) reject("invalid_quote_calculation");
      if (quoteDraftLimit(staged)) reject("draft_payload_limit");
      const contextError = input.validateStaged?.(staged);
      if (contextError) reject(contextError);
      for (const id of mutation.changed ?? []) changed.add(id);
      for (const field of mutation.changedFields ?? []) changedFields.add(field);
      const changedLineIds = mutation.changed ?? [];
      const calculation = calculateQuote(staged);
      const details = {
        changed: changedLineIds,
        changedFields: mutation.changedFields ?? [],
        calculation: {
          lines: calculation.lines.filter((line) => changedLineIds.includes(line.id)),
          sections: calculation.sections,
          subtotal: calculation.subtotal,
          discount: calculation.discount,
          net: calculation.net,
          vat: calculation.vat,
          total: calculation.total,
        },
        ...(changedLineIds.length ? { normalizedLines: changedLineIds.flatMap((id) => {
          const line = staged.lines.find((candidate) => candidate.id === id);
          return line ? [{ id: line.id, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount }] : [];
        }) } : {}),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
    } catch (error) {
      restoreQuote(staged, before);
      changed.clear(); changedBefore.forEach((id) => changed.add(id));
      changedFields.clear(); changedFieldsBefore.forEach((field) => changedFields.add(field));
      copyFacts.length = copyFactsBefore;
      capturedLineIds.splice(0, capturedLineIds.length, ...capturedBefore);
      lastErrorCode = error instanceof ToolValidationError ? error.code : lastErrorCode ?? "tool_execution_failed";
      throw new Error(toolErrorMessage(lastErrorCode));
    }
  };

  const prepare = (validate: (args: unknown) => void) => (args: unknown) => {
    try { validate(args); return args; } catch (error) {
      lastErrorCode = error instanceof ToolValidationError ? error.code : "invalid_tool_arguments";
      return reject(lastErrorCode);
    }
  };

  const editQuoteDetails: AgentTool = {
    name: "edit_quote_details",
    label: "Edit Quote details",
    description: "Edit the current Working Draft's reference, project title, dates, work-site address, Customer and business details, terms, VAT registration and identifier, or discount. Include only fields to change. Use an empty string to clear a text or decimal field. Do not supply calculated totals, currency or VAT rates.",
    parameters: editQuoteDetailsParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { editQuoteDetailsInput(args, evidenceContext, staged, input.referenceLocked ?? false); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const fields = editQuoteDetailsInput(params, evidenceContext, staged, input.referenceLocked ?? false);
      const changedNow: string[] = [];
      for (const field of detailFields) {
        if (!Object.hasOwn(fields, field)) continue;
        const value = fields[field];
        if (staged[field] === value) continue;
        if (field === "reference" && input.referenceLocked) reject("reference_locked");
        (staged as Record<DetailField, unknown>)[field] = value;
        changedNow.push(field);
      }
      return changedNow.length ? { changedFields: changedNow } : {};
    }),
  };

  const editQuoteLines: AgentTool = {
    name: "edit_quote_lines",
    label: "Edit Quote lines",
    description: "Create or edit up to 50 Quote Lines in one call. Supply each line's complete description and pricing information. Include its existing ID to edit it; omit the ID to create a new line. Preserve unchanged values from the current draft. Use empty strings for unknown values, deliberately cleared values and fields unused by the selected pricing mode. Do not copy, move or delete lines with this tool.",
    parameters: editQuoteLinesParameters,
    executionMode: "sequential",
    prepareArguments: prepare((args) => { editQuoteLinesInput(args, evidenceContext, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const lines = editQuoteLinesInput(params, evidenceContext, staged);
      if (staged.lines.length + lines.filter((line) => !line.id).length > MAX_QUOTE_LINES) reject();
      const changedNow: string[] = [];
      for (const submitted of lines) {
        if (submitted.id) {
          const line = staged.lines.find((candidate) => candidate.id === submitted.id)!;
          const next: QuoteLine = { ...line, ...withoutUndefined(submitted), sectionId: line.sectionId };
          if (JSON.stringify(line) !== JSON.stringify(next)) {
            Object.assign(line, next);
            changedNow.push(line.id);
          }
        } else {
          const id = newLineId(staged);
          const line: QuoteLine = { id, sectionId: submitted.sectionId ?? "", description: submitted.description, mode: submitted.mode, quantity: submitted.quantity, unit: submitted.unit, unitPrice: submitted.unitPrice, amount: submitted.amount };
          staged.lines.push(line);
          capturedLineIds.push(id);
          changedNow.push(id);
        }
      }
      return changedNow.length ? { changed: changedNow } : {};
    }),
  };

  // Structural tools remain until #28. Their established movement, copying and copy-fact behavior is unchanged.
  const createQuoteSection: AgentTool = {
    name: "create_quote_section", label: "Create Quote Section", description: "Create a new French-named Quote Section. Section IDs are generated by the application.", parameters: sectionTitleParameters, executionMode: "sequential",
    prepareArguments: prepare((args) => { sectionTitleInput(args); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const { title } = sectionTitleInput(params);
      if (staged.sections.length >= MAX_QUOTE_SECTIONS) reject();
      const id = newSectionId(staged); staged.sections.push({ id, title });
      return { changedFields: [`section:${id}`] };
    }),
  };
  const renameQuoteSection: AgentTool = {
    name: "rename_quote_section", label: "Rename Quote Section", description: "Rename one existing Quote Section using its stable section ID.", parameters: Type.Object({ ...sectionIdParameters.properties, title: Type.String({ minLength: 1, maxLength: MAX_SECTION_TITLE }) }, { additionalProperties: false }), executionMode: "sequential",
    prepareArguments: prepare((args) => { renameSectionInput(args); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const { sectionId, title } = renameSectionInput(params); const section = staged.sections.find((candidate) => candidate.id === sectionId);
      if (!section) reject(); if (section!.title === title) return {}; section!.title = title;
      return { changedFields: [`section:${sectionId}`] };
    }),
  };
  const moveQuoteLine: AgentTool = {
    name: "move_quote_line", label: "Move Quote Line", description: "Move an existing Quote Line to a section or No section. Moving appends it to the destination group.", parameters: moveLineParameters, executionMode: "sequential",
    prepareArguments: prepare((args) => { moveLineInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const { lineId, sectionId } = moveLineInput(params, staged); const line = staged.lines.find((candidate) => candidate.id === lineId)!;
      if (line.sectionId === sectionId) return {}; staged.lines = appendQuoteLineToSection(staged.lines, { ...line, sectionId }, staged.sections);
      return { changed: [lineId] };
    }),
  };
  const duplicateQuoteLine: AgentTool = {
    name: "duplicate_quote_line", label: "Duplicate Quote Line", description: "Duplicate one existing Quote Line with a fresh application ID. Copy values from the source; when measurements are unknown, use measurementPolicy unknown.", parameters: duplicateLineParameters, executionMode: "sequential",
    prepareArguments: prepare((args) => { duplicateLineInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const copyInput = duplicateLineInput(params, staged); if (staged.lines.length >= MAX_QUOTE_LINES) reject();
      const source = staged.lines.find((candidate) => candidate.id === copyInput.lineId)!;
      const unknownMeasurements = copyInput.measurementPolicy === "unknown";
      const copy = copyLine(source, newLineId(staged), copyInput.sectionId ?? source.sectionId, unknownMeasurements);
      staged.lines = insertAfterSource(staged.lines, source.id, copy, staged.sections); copyFacts.push(copyFact(copy, unknownMeasurements));
      return { changed: [copy.id] };
    }),
  };
  const duplicateQuoteSection: AgentTool = {
    name: "duplicate_quote_section", label: "Duplicate Quote Section", description: "Duplicate a Quote Section and all its contained work with fresh application IDs. Use measurementPolicy unknown when copied quantities are not known.", parameters: duplicateSectionParameters, executionMode: "sequential",
    prepareArguments: prepare((args) => { duplicateSectionInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const copyInput = duplicateSectionInput(params, staged);
      if (staged.sections.length >= MAX_QUOTE_SECTIONS || staged.lines.length + staged.lines.filter((line) => line.sectionId === copyInput.sectionId).length > MAX_QUOTE_LINES) reject();
      const source = staged.sections.find((candidate) => candidate.id === copyInput.sectionId)!; const id = newSectionId(staged);
      const copy = { ...source, id, title: `${source.title} copie` }; const sourceLines = staged.lines.filter((line) => line.sectionId === source.id);
      const unknownMeasurements = copyInput.measurementPolicy === "unknown";
      const uniqueCopies = sourceLines.reduce<QuoteLine[]>((result, line) => {
        const copied = copyLine(line, newLineId({ ...staged, lines: [...staged.lines, ...result] }), id, unknownMeasurements);
        copyFacts.push(copyFact(copied, unknownMeasurements)); result.push(copied); return result;
      }, []);
      const sectionIndex = staged.sections.findIndex((candidate) => candidate.id === source.id);
      staged.sections.splice(sectionIndex + 1, 0, copy); staged.lines = groupedWithSections(staged.lines.concat(uniqueCopies), staged.sections);
      return { changed: uniqueCopies.map((line) => line.id), changedFields: [`section:${id}`] };
    }),
  };

  return {
    tools: [editQuoteDetails, editQuoteLines, createQuoteSection, renameQuoteSection, moveQuoteLine, duplicateQuoteLine, duplicateQuoteSection],
    result: () => ({
      quote: cloneQuote(staged), changed: [...changed], capturedLineIds: [...capturedLineIds],
      ...(changedFields.size ? { changedFields: [...changedFields] } : {}),
      ...(copyFacts.length ? { copyFacts: copyFacts.map((fact) => {
        const line = staged.lines.find((candidate) => candidate.id === fact.lineId); return line ? copyFact(line, fact.quantityUnknown) : { ...fact };
      }) } : {}),
    }),
    diagnostic: () => lastErrorCode ? { phase: "tool", code: lastErrorCode } : undefined,
  };
}

function editQuoteDetailsInput(value: unknown, context: EvidenceContext, quote: QuoteData, referenceLocked: boolean): Partial<Pick<QuoteData, DetailField>> {
  if (!isRecord(value) || !isExactKeys(value, ["fields", "evidence"]) || !isRecord(value.fields)) throw new ToolValidationError("invalid_tool_arguments");
  const fields = value.fields;
  const keys = Object.keys(fields);
  if (!keys.length || keys.some((key) => !detailFields.includes(key as DetailField))) throw new ToolValidationError("invalid_tool_arguments");
  const result: Partial<Pick<QuoteData, DetailField>> = {};
  for (const field of detailTextFields) {
    if (!Object.hasOwn(fields, field)) continue;
    const supplied = fields[field]; const max = field === "reference" ? 200 : field === "issueDate" || field === "validUntil" ? 10 : field === "discount" ? MAX_DECIMAL : MAX_DETAIL_TEXT;
    if (typeof supplied !== "string" || supplied.length > max
      || (field === "discount" && supplied !== "" && !boundedDecimal(supplied, 2))) throw new ToolValidationError("invalid_tool_arguments");
    result[field] = supplied;
  }
  if (Object.hasOwn(fields, "vatRegistered")) {
    if (fields.vatRegistered !== null && typeof fields.vatRegistered !== "boolean") throw new ToolValidationError("invalid_tool_arguments");
    result.vatRegistered = fields.vatRegistered;
  }
  if (Object.hasOwn(fields, "discountMode")) {
    if (fields.discountMode !== "none" && fields.discountMode !== "percent" && fields.discountMode !== "fixed") throw new ToolValidationError("invalid_tool_arguments");
    result.discountMode = fields.discountMode;
  }
  if (referenceLocked && Object.hasOwn(result, "reference") && result.reference !== quote.reference) throw new ToolValidationError("reference_locked");
  const requestedEvidence = detailFields.filter((field) => Object.hasOwn(result, field) && result[field] !== quote[field] && nonemptyCommercialValue(result[field]));
  const nextMode = result.discountMode ?? quote.discountMode;
  if (nextMode === "none") {
    if (Object.hasOwn(result, "discount") && typeof result.discount === "string" && result.discount !== "" && !isZeroDecimal(result.discount)) {
      throw new ToolValidationError("discount_not_applicable");
    }
    result.discount = "0";
  } else if (Object.hasOwn(result, "discountMode") && result.discountMode !== quote.discountMode && !Object.hasOwn(result, "discount")) {
    result.discount = "";
  }
  assertGroupedEvidence(value.evidence, context, requestedEvidence, (field) => detailFields.includes(field as DetailField));
  return result;
}

function editQuoteLinesInput(value: unknown, context: EvidenceContext, quote: QuoteData): EditableLine[] {
  if (!isRecord(value) || !isExactKeys(value, ["lines", "evidence"]) || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 50) throw new ToolValidationError("invalid_tool_arguments");
  const ids = new Set<string>();
  const lines = value.lines.map((item, index) => {
    if (!isRecord(item) || !isExactKeys(item, ["id", "sectionId", "description", "mode", "quantity", "unit", "unitPrice", "amount"])
      || !Object.hasOwn(item, "description") || !Object.hasOwn(item, "mode") || !Object.hasOwn(item, "quantity") || !Object.hasOwn(item, "unit") || !Object.hasOwn(item, "unitPrice") || !Object.hasOwn(item, "amount")) throw new ToolValidationError("invalid_tool_arguments");
    const id = item.id;
    if (id !== undefined && (typeof id !== "string" || !lineIdSyntax(id) || ids.has(id) || !quote.lines.some((line) => line.id === id))) throw new ToolValidationError("invalid_line_id");
    if (id !== undefined) ids.add(id);
    if (item.sectionId !== undefined && (id !== undefined || typeof item.sectionId !== "string" || item.sectionId.length > 128 || (item.sectionId !== "" && !quote.sections.some((section) => section.id === item.sectionId)))) throw new ToolValidationError("invalid_section_id");
    if (typeof item.description !== "string" || item.description.length > MAX_LINE_DESCRIPTION || (item.mode !== "quantity" && item.mode !== "fixed")
      || typeof item.quantity !== "string" || !boundedDecimal(item.quantity, 3) || typeof item.unit !== "string" || item.unit.length > MAX_UNIT
      || typeof item.unitPrice !== "string" || !boundedDecimal(item.unitPrice, 2) || typeof item.amount !== "string" || !boundedDecimal(item.amount, 2)) throw new ToolValidationError("invalid_tool_arguments");
    if ((item.mode === "quantity" && item.amount !== "") || (item.mode === "fixed" && (item.quantity !== "" || item.unit !== "" || item.unitPrice !== ""))) throw new ToolValidationError("invalid_mode_fields");
    return { ...(id === undefined ? {} : { id }), ...(item.sectionId === undefined ? {} : { sectionId: item.sectionId }), description: item.description, mode: item.mode, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, amount: item.amount } as EditableLine;
  });
  const requiredEvidence: string[] = [];
  lines.forEach((line, index) => {
    const existing = line.id ? quote.lines.find((candidate) => candidate.id === line.id)! : undefined;
    if (!existing || line.mode !== existing.mode) requiredEvidence.push(`/lines/${index}/mode`);
    for (const field of ["description", "quantity", "unit", "unitPrice", "amount"] as const) {
      if (nonemptyCommercialValue(line[field]) && (!existing || line[field] !== existing[field])) requiredEvidence.push(`/lines/${index}/${field}`);
    }
  });
  assertGroupedEvidence(value.evidence, context, requiredEvidence, (field) => /^\/lines\/(?:0|[1-9]\d*)\/(?:description|mode|quantity|unit|unitPrice|amount)$/.test(field) && Number(field.split("/")[2]) < lines.length);
  return lines;
}

function assertGroupedEvidence(value: unknown, context: EvidenceContext, requiredFields: readonly string[], fieldAllowed: (field: string) => boolean) {
  if (value === undefined) {
    if (requiredFields.length) throw new ToolValidationError("missing_evidence");
    return;
  }
  if (!Array.isArray(value) || !value.length || value.length > MAX_EVIDENCE) throw new ToolValidationError("invalid_evidence");
  const supported = new Set<string>();
  for (const item of value) {
    if (!isExactRecord(item, ["fields", "source", "text"]) || !Array.isArray(item.fields) || !item.fields.length || item.fields.length > MAX_EVIDENCE_FIELDS
      || new Set(item.fields).size !== item.fields.length || item.fields.some((field) => typeof field !== "string" || !field || field.length > MAX_EVIDENCE_FIELD || !fieldAllowed(field))
      || typeof item.source !== "string" || !item.source || item.source.length > MAX_EVIDENCE_SOURCE || typeof item.text !== "string" || !item.text || item.text.length > MAX_EVIDENCE_TEXT) throw new ToolValidationError("invalid_evidence");
    if (!evidenceAppears(evidenceSource(context, item.source), item.text)) throw new ToolValidationError("evidence_not_found");
    item.fields.forEach((field) => supported.add(field));
  }
  if (requiredFields.some((field) => !supported.has(field))) throw new ToolValidationError("missing_evidence");
}

function evidenceSource(context: EvidenceContext, source: string): string {
  if (source === "current") return context.artisanText;
  const history = context.artisanHistory.find((entry) => entry.source === source);
  if (history && /^history_\d+$/.test(source)) return history.text;
  const quoteField = /^quote\.([A-Za-z][A-Za-z0-9]*)$/.exec(source)?.[1];
  if (quoteField && detailFields.includes(quoteField as DetailField)) return String(context.originalQuote[quoteField as DetailField] ?? "");
  const lineMatch = /^line:([^.:]+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(source);
  if (lineMatch) {
    const line = context.originalLines.get(lineMatch[1]);
    if (line && ["id", "sectionId", "description", "mode", "quantity", "unit", "unitPrice", "amount"].includes(lineMatch[2])) return line[lineMatch[2] as keyof QuoteLine];
  }
  const sectionMatch = /^section:([^.:]+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(source);
  if (sectionMatch) {
    const section = context.originalSections.get(sectionMatch[1]);
    if (section && ["id", "title"].includes(sectionMatch[2])) return section[sectionMatch[2] as "id" | "title"];
  }
  throw new ToolValidationError("unknown_evidence_source");
}

function nonemptyCommercialValue(value: unknown): boolean { return value !== "" && value !== null && value !== undefined; }
function boundedDecimal(value: string, places: number): boolean {
  if (value === "") return true;
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > places) return false;
  const scaled = BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] ?? "").padEnd(places, "0"));
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER);
}
function isZeroDecimal(value: string): boolean {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value);
  return !!match && BigInt(match[1]) === 0n && BigInt(match[2] ?? "0") === 0n;
}
function lineIdSyntax(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && value.length <= 128; }
function withoutUndefined<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T; }

function toolErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    invalid_tool_arguments: "The tool arguments are invalid. Resubmit the complete call with the required fields.",
    missing_evidence: "Each changed nonempty commercial fact needs a citation from an application-supplied source.",
    evidence_not_found: "The evidence excerpt was not found in the cited application-supplied source.",
    unknown_evidence_source: "The evidence source is not available in the current application context.",
    reference_locked: "The Quote reference is fixed after first Publication and cannot be changed.",
    discount_not_applicable: "A nonzero discount cannot be used when discountMode is none.",
    invalid_mode_fields: "Supply empty strings for fields unused by the selected pricing mode.",
    invalid_line_id: "Use each existing stable Quote Line ID at most once; omit id to create a line.",
    invalid_section_id: "sectionId is allowed only for a new line and must name an existing Quote Section.",
    draft_payload_limit: "The Working Draft is too large for this change. Continue manually.",
  };
  return `Tool input rejected. Reason: ${code}. ${messages[code] ?? "Check its target and values, then resubmit the complete call."}`;
}

function restoreQuote(target: QuoteData, source: QuoteData) { Object.assign(target, source, { sections: source.sections.map((section) => ({ ...section })), lines: source.lines.map((line) => ({ ...line })) }); }
function cloneQuote(quote: QuoteData): QuoteData { return { ...quote, sections: quote.sections.map((section) => ({ ...section })), lines: quote.lines.map((line) => ({ ...line })) }; }

function assertInitialInput(input: CreateQuoteToolsInput) {
  const history = input.artisanHistorySources ?? input.artisanHistory;
  if (typeof input.artisanText !== "string" || input.artisanText.length > MAX_ARTISAN_TEXT || !Array.isArray(input.capturedLineIds)
    || (history !== undefined && (!Array.isArray(history) || history.length > MAX_ARTISAN_HISTORY_MESSAGES
      || history.some((entry) => typeof entry === "string" ? entry.length > MAX_ARTISAN_TEXT : !isRecord(entry) || typeof entry.source !== "string" || !/^history_\d+$/.test(entry.source) || entry.source.length > MAX_EVIDENCE_SOURCE || typeof entry.text !== "string" || entry.text.length > MAX_ARTISAN_TEXT)
      || (input.artisanHistorySources !== undefined && new Set(input.artisanHistorySources.map((entry) => entry.source)).size !== input.artisanHistorySources.length)
      || history.reduce((total, entry) => total + (typeof entry === "string" ? entry.length : typeof entry === "object" && entry !== null && "text" in entry && typeof entry.text === "string" ? entry.text.length : MAX_ARTISAN_TEXT + 1), 0) > MAX_ARTISAN_HISTORY_CHARS))) throw new Error("Tool input rejected.");
  const calculation = calculateQuote(input.quote);
  if (!calculation.quote || calculation.errors.length || quoteDraftLimit(input.quote)) throw new Error("Tool input rejected.");
}

function newLineId(quote: QuoteData): string { const ids = new Set(quote.lines.map((line) => line.id)); for (let attempt = 0; attempt < 10; attempt += 1) { const id = randomUUID(); if (!ids.has(id)) return id; } throw new Error("invalid"); }
function sectionTitleInput(value: unknown): { title: string } { if (!isExactRecord(value, ["title"]) || typeof value.title !== "string" || !value.title.trim() || value.title.length > MAX_SECTION_TITLE) throw new Error("invalid"); return { title: value.title.trim() }; }
function renameSectionInput(value: unknown): { sectionId: string; title: string } { if (!isRecord(value) || !isExactRecord(value, ["sectionId", "title"]) || typeof value.sectionId !== "string" || !value.sectionId || value.sectionId.length > 128) throw new Error("invalid"); return { sectionId: value.sectionId, title: sectionTitleInput({ title: value.title }).title }; }
function moveLineInput(value: unknown, quote: QuoteData): { lineId: string; sectionId: string } { if (!isExactRecord(value, ["lineId", "sectionId"]) || typeof value.lineId !== "string" || !value.lineId || typeof value.sectionId !== "string" || value.sectionId.length > 128 || !quote.lines.some((line) => line.id === value.lineId) || (value.sectionId !== "" && !quote.sections.some((section) => section.id === value.sectionId))) throw new Error("invalid"); return { lineId: value.lineId, sectionId: value.sectionId }; }
function duplicateLineInput(value: unknown, quote: QuoteData): { lineId: string; sectionId?: string; measurementPolicy: "retain" | "unknown" } { if (!isRecord(value) || Object.keys(value).some((key) => !["lineId", "sectionId", "measurementPolicy"].includes(key)) || typeof value.lineId !== "string" || !value.lineId || !quote.lines.some((line) => line.id === value.lineId) || (value.sectionId !== undefined && (typeof value.sectionId !== "string" || value.sectionId.length > 128 || (value.sectionId !== "" && !quote.sections.some((section) => section.id === value.sectionId))))) throw new Error("invalid"); if (value.measurementPolicy !== undefined && value.measurementPolicy !== "retain" && value.measurementPolicy !== "unknown") throw new Error("invalid"); return { lineId: value.lineId, ...(value.sectionId === undefined ? {} : { sectionId: value.sectionId }), measurementPolicy: value.measurementPolicy ?? "retain" }; }
function duplicateSectionInput(value: unknown, quote: QuoteData): { sectionId: string; measurementPolicy: "retain" | "unknown" } { if (!isRecord(value) || Object.keys(value).some((key) => !["sectionId", "measurementPolicy"].includes(key)) || typeof value.sectionId !== "string" || !value.sectionId || !quote.sections.some((section) => section.id === value.sectionId)) throw new Error("invalid"); if (value.measurementPolicy !== undefined && value.measurementPolicy !== "retain" && value.measurementPolicy !== "unknown") throw new Error("invalid"); return { sectionId: value.sectionId, measurementPolicy: value.measurementPolicy ?? "retain" }; }
function newSectionId(quote: QuoteData): string { const ids = new Set(quote.sections.map((section) => section.id)); for (let attempt = 0; attempt < 10; attempt += 1) { const id = `section-${randomUUID()}`; if (!ids.has(id)) return id; } throw new Error("invalid"); }
function insertAfterSource(lines: QuoteLine[], sourceId: string, copy: QuoteLine, sections: { id: string }[]): QuoteLine[] { const source = lines.find((line) => line.id === sourceId)!; if (copy.sectionId === source.sectionId) { const result = [...lines]; result.splice(result.findIndex((line) => line.id === sourceId) + 1, 0, copy); return result; } return appendQuoteLineToSection(lines, copy, sections); }
function groupedWithSections(lines: QuoteLine[], sections: { id: string }[]): QuoteLine[] { return [...lines.filter((line) => line.sectionId === ""), ...sections.flatMap((section) => lines.filter((line) => line.sectionId === section.id)), ...lines.filter((line) => line.sectionId !== "" && !sections.some((section) => section.id === line.sectionId))]; }
function copyLine(source: QuoteLine, id: string, sectionId: string, unknownMeasurements: boolean): QuoteLine { const copy = { ...source, id, sectionId }; if (unknownMeasurements && source.mode === "quantity") { copy.quantity = ""; copy.amount = ""; copy.description = withoutMeasurement(copy.description); } return copy; }
function copyFact(line: QuoteLine, quantityUnknown: boolean): CopyFact { return { lineId: line.id, mode: line.mode, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount, quantityUnknown }; }
function withoutMeasurement(description: string): string { return description.replace(/\b\d+(?:[.,]\d+)?\s*(?:[x×/]\s*\d+(?:[.,]\d+)?)+(?:\s*(?:m|cm|mm))?\b/giu, "").replace(/\b\d+(?:[.,]\d+)?\s*(?:m²|m2|cm|mm|km|m|kg|g|l|cl|ml|h|heures?|jours?|pce|pièces?|mètres? carrés?|metres? carres?|mètres? cubes?|metres? cubes?|square meters?|square metres?|cubic meters?|cubic metres?|sq\.?\s*m|pieds?|feet|litres?|liters?|kilogrammes?|kilograms?)\b/giu, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/([(:])\s+/g, "$1").trim(); }
function evidenceAppears(text: string, evidence: string): boolean { const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase(); return compact(text).includes(compact(evidence)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
/** Allows optional schema properties while rejecting unknown keys. */
function isExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
