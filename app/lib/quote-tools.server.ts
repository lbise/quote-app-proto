import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";
import { Errors, Pointer } from "typebox/value";
import { Settings } from "typebox/system";

import {
  editQuoteLinesDescription,
  editQuoteLinesParameters,
  evidenceTextDescription,
} from "../../docs/assistant-contract/edit-quote-lines";
import { calculateQuote, type QuoteData, type QuoteLine } from "./quote";
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
  copyMappings?: { sourceId: string; newId: string }[];
};

export type QuoteToolsDiagnostic = { phase: "tool"; code: string; tool?: string };

type EvidenceRepair = { invalidTextField: string; source: string; excerpts: readonly string[]; escapedWhitespace: boolean };

class ToolValidationError extends Error {
  constructor(
    readonly code: string,
    readonly missingEvidenceFields: readonly string[] = [],
    readonly invalidEvidenceTextFields: readonly string[] = [],
    readonly evidenceRepairs: readonly EvidenceRepair[] = [],
  ) { super(code); }
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
const MAX_EVIDENCE_REPAIR_EXCERPT = 240;
const MAX_EVIDENCE_REPAIR_PARTS = 3;
const MAX_EVIDENCE_REPAIRS = 2;
const ESCAPED_WHITESPACE = /(?:\\r\\n|\\[nrt])+/u;

const evidenceCitationParameters = Type.Object({
  fields: Type.Array(Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_FIELD }), {
    minItems: 1, maxItems: MAX_EVIDENCE_FIELDS, uniqueItems: true,
    description: "Fields supported by this citation. For edit_quote_details, use field names such as discountMode and discount. For other tools, use JSON Pointers such as /sections/0/title.",
  }),
  source: Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_SOURCE, description: 'Use "current" for currentMessage.text, not "currentMessage" or "currentMessage.text". Use a supplied history_N ID for an earlier Artisan message. quote.FIELD refers only to that field in the supplied currentWorkingDraft; quote.title contains the existing Quote title, not the Artisan message. line:ID.FIELD and section:ID.FIELD refer to existing supplied work by stable ID. Never invent a source ID or cite an assistant message.' }),
  text: Type.String({ minLength: 1, maxLength: MAX_EVIDENCE_TEXT, description: evidenceTextDescription }),
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

const editQuoteSectionsParameters = Type.Object({
  sections: Type.Array(Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" })),
    title: Type.String({ maxLength: MAX_SECTION_TITLE }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
  evidence: Type.Optional(Type.Array(evidenceCitationParameters, { minItems: 1, maxItems: MAX_EVIDENCE, description: 'Required for every new or changed nonempty title. Cover /sections/0/title, /sections/1/title, etc. for all changed titles, not just the first. These indexes refer to the sections array in this call. One supporting message excerpt can cover multiple titles in one citation with source "current". Omit only for unchanged or cleared titles.' })),
}, { additionalProperties: false });
const copyQuoteWorkParameters = Type.Object({
  source: Type.Union([
    Type.Object({
      lineIds: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }), { minItems: 1, maxItems: 50, uniqueItems: true }),
      destinationSectionId: Type.Optional(Type.String({ maxLength: 128 })),
    }, { additionalProperties: false }),
    Type.Object({
      sectionId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }),
      title: Type.String({ minLength: 1, maxLength: MAX_SECTION_TITLE }),
    }, { additionalProperties: false }),
  ]),
  measurementPolicy: StringEnum(["retain", "unknown"]),
  evidence: Type.Optional(Type.Array(evidenceCitationParameters, { minItems: 1, maxItems: MAX_EVIDENCE, description: "Cite the supplied section title with /source/title when copying a section. Line copies only need evidence when they introduce a new nonempty commercial fact; omit for unchanged values or deliberate clearing." })),
}, { additionalProperties: false });
const moveQuoteWorkParameters = Type.Object({
  move: Type.Union([
    Type.Object({
      lineIds: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }), { minItems: 1, maxItems: 50, uniqueItems: true }),
      destinationSectionId: Type.String({ maxLength: 128 }),
      beforeLineId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" })),
    }, { additionalProperties: false }),
    Type.Object({
      sectionIds: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }), { minItems: 1, maxItems: 50, uniqueItems: true }),
      beforeSectionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" })),
    }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
const deleteQuoteLinesParameters = Type.Object({
  lineIds: Type.Array(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }), { minItems: 1, maxItems: 50, uniqueItems: true }),
}, { additionalProperties: false });

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
  const copyMappings: { sourceId: string; newId: string }[] = [];
  const deletedOriginalLineIds = new Set<string>();
  const originalLineIds = new Set(originalQuote.lines.map((line) => line.id));
  let lastErrorCode: string | undefined;

  const reject = (code = "invalid_tool_input", details?: ToolValidationError, schemaHints = ""): never => {
    lastErrorCode = code;
    throw new Error(toolErrorMessage(code, details) + schemaHints);
  };

  const mutate = async (signal: AbortSignal | undefined, operation: () => Mutation) => {
    if (signal?.aborted) reject("tool_aborted");
    const before = cloneQuote(staged);
    const changedBefore = new Set(changed);
    const changedFieldsBefore = new Set(changedFields);
    const copyFactsBefore = copyFacts.length;
    const copyMappingsBefore = copyMappings.length;
    const deletedOriginalBefore = new Set(deletedOriginalLineIds);
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
        ...(copyMappings.length > copyMappingsBefore ? { copyMappings: copyMappings.slice(copyMappingsBefore) } : {}),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
    } catch (error) {
      restoreQuote(staged, before);
      changed.clear(); changedBefore.forEach((id) => changed.add(id));
      changedFields.clear(); changedFieldsBefore.forEach((field) => changedFields.add(field));
      copyFacts.length = copyFactsBefore;
      copyMappings.length = copyMappingsBefore;
      deletedOriginalLineIds.clear();
      deletedOriginalBefore.forEach((id) => deletedOriginalLineIds.add(id));
      capturedLineIds.splice(0, capturedLineIds.length, ...capturedBefore);
      lastErrorCode = error instanceof ToolValidationError ? error.code : lastErrorCode ?? "tool_execution_failed";
      throw new Error(toolErrorMessage(lastErrorCode, error instanceof ToolValidationError ? error : undefined));
    }
  };

  const prepare = (parameters: TSchema, validate: (args: unknown) => void) => (args: unknown) => {
    try { validate(args); return args; } catch (error) {
      lastErrorCode = error instanceof ToolValidationError ? error.code : "invalid_tool_arguments";
      return reject(lastErrorCode, error instanceof ToolValidationError ? error : undefined, schemaRepairHints(parameters, args));
    }
  };

  const editQuoteDetails: AgentTool = {
    name: "edit_quote_details",
    label: "Edit Quote details",
    description: "Edit the current Working Draft's reference, project title, dates, work-site address, Customer and business details, terms, VAT registration and identifier, or discount. Include only fields to change. Use an empty string to clear a text or decimal field. Do not supply calculated totals, currency or VAT rates.",
    parameters: editQuoteDetailsParameters,
    executionMode: "sequential",
    prepareArguments: prepare(editQuoteDetailsParameters, (args) => { editQuoteDetailsInput(args, evidenceContext, staged, input.referenceLocked ?? false); }),
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
    description: editQuoteLinesDescription,
    parameters: editQuoteLinesParameters,
    executionMode: "sequential",
    prepareArguments: prepare(editQuoteLinesParameters, (args) => { editQuoteLinesInput(args, evidenceContext, staged); }),
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

  const editQuoteSections: AgentTool = {
    name: "edit_quote_sections", label: "Edit Quote Sections",
    description: 'Create or rename up to 50 Quote Sections. Include an existing stable ID to rename it; omit the ID to create a section at the end. An empty title leaves an incomplete section and never deletes it. Cite the supplied work or room description for every new or changed nonempty title; faithful French rewording is allowed. For the latest Artisan message, use source "current", which identifies currentMessage.text. "currentMessage" is not a valid source ID. One citation can cover every title supported by the same excerpt, but its fields must list each affected /sections/INDEX/title. Example only: if currentMessage.text contains "Prévois une rubrique Cuisine et une rubrique Couloir.", a valid call is {"sections":[{"title":"Cuisine"},{"title":"Couloir"}],"evidence":[{"fields":["/sections/0/title","/sections/1/title"],"source":"current","text":"Prévois une rubrique Cuisine et une rubrique Couloir."}]}. Use the actual supplied rooms and excerpt, not these example values. After a citation rejection, correct the source, excerpt or missing fields in the complete call; do not replace supporting work notes with unrelated Quote metadata. Do not add, edit, move, copy or delete Quote Lines with this tool. Do not move, copy or delete sections with this tool.',
    parameters: editQuoteSectionsParameters, executionMode: "sequential",
    prepareArguments: prepare(editQuoteSectionsParameters, (args) => { editQuoteSectionsInput(args, evidenceContext, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const sections = editQuoteSectionsInput(params, evidenceContext, staged);
      if (staged.sections.length + sections.filter((section) => !section.id).length > MAX_QUOTE_SECTIONS) reject();
      const changedNow: string[] = [];
      for (const submitted of sections) {
        if (submitted.id) {
          const section = staged.sections.find((candidate) => candidate.id === submitted.id)!;
          if (section.title !== submitted.title) { section.title = submitted.title; changedNow.push(`section:${section.id}`); }
        } else {
          const id = newSectionId(staged);
          staged.sections.push({ id, title: submitted.title });
          changedNow.push(`section:${id}`);
        }
      }
      return changedNow.length ? { changedFields: changedNow } : {};
    }),
  };

  const copyQuoteWork: AgentTool = {
    name: "copy_quote_work", label: "Copy Quote work",
    description: "Copy up to 50 explicitly identified Quote Lines, or one complete Quote Section with a supplied title. Copies receive fresh IDs and retain values unless measurementPolicy is unknown.",
    parameters: copyQuoteWorkParameters, executionMode: "sequential",
    prepareArguments: prepare(copyQuoteWorkParameters, (args) => { copyQuoteWorkInput(args, evidenceContext, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const copyInput = copyQuoteWorkInput(params, evidenceContext, staged);
      const unknownMeasurements = copyInput.measurementPolicy === "unknown";
      if (copyInput.source.kind === "lines") {
        if (staged.lines.length + copyInput.source.lineIds.length > MAX_QUOTE_LINES) reject();
        const copies: QuoteLine[] = [];
        for (const sourceId of copyInput.source.lineIds) {
          const source = staged.lines.find((line) => line.id === sourceId)!;
          const id = newLineId({ ...staged, lines: [...staged.lines, ...copies] });
          const destination = copyInput.source.destinationSectionId ?? source.sectionId;
          const copy = copyLine(source, id, destination, unknownMeasurements);
          copies.push(copy);
          copyMappings.push({ sourceId, newId: id });
          copyFacts.push(copyFact(copy, unknownMeasurements));
        }
        if (copyInput.source.destinationSectionId !== undefined) {
          for (const copy of copies) staged.lines = insertAtDestinationEnd(staged.lines, copy, staged.sections);
        } else {
          for (const [index, copy] of copies.entries()) {
            staged.lines = insertAfterSource(staged.lines, copyInput.source.lineIds[index], copy, staged.sections);
          }
        }
        return { changed: copies.map((line) => line.id) };
      }

      const sectionSource = copyInput.source;
      if (sectionSource.kind !== "section") reject();
      const source = staged.sections.find((section) => section.id === sectionSource.sectionId)!;
      const sourceLines = staged.lines.filter((line) => line.sectionId === source.id);
      if (staged.sections.length >= MAX_QUOTE_SECTIONS || sourceLines.length > 50 || staged.lines.length + sourceLines.length > MAX_QUOTE_LINES) reject("bulk_limit_exceeded");
      const id = newSectionId(staged);
      const section = { id, title: sectionSource.title };
      const copiesSoFar: QuoteLine[] = [];
      const copies = sourceLines.map((line) => {
        const copy = copyLine(line, newLineId({ ...staged, lines: [...staged.lines, ...copiesSoFar] }), id, unknownMeasurements);
        copyMappings.push({ sourceId: line.id, newId: copy.id });
        copyFacts.push(copyFact(copy, unknownMeasurements));
        copiesSoFar.push(copy);
        return copy;
      });
      const sectionIndex = staged.sections.findIndex((candidate) => candidate.id === source.id);
      staged.sections.splice(sectionIndex + 1, 0, section);
      staged.lines = groupedWithSections(staged.lines.concat(copies), staged.sections);
      return { changed: copies.map((line) => line.id), changedFields: [`section:${id}`] };
    }),
  };

  const moveQuoteWork: AgentTool = {
    name: "move_quote_work", label: "Move Quote work",
    description: "Move or reorder up to 50 Quote Lines or Quote Sections. Selected IDs are placed in the supplied order; an omitted anchor appends to the destination.",
    parameters: moveQuoteWorkParameters, executionMode: "sequential",
    prepareArguments: prepare(moveQuoteWorkParameters, (args) => { moveQuoteWorkInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const move = moveQuoteWorkInput(params, staged);
      if (move.kind === "lines") {
        const selected = new Set(move.lineIds);
        const moved = move.lineIds.map((id) => ({ ...staged.lines.find((line) => line.id === id)! , sectionId: move.destinationSectionId }));
        const remaining = staged.lines.filter((line) => !selected.has(line.id));
        const at = move.beforeLineId ? remaining.findIndex((line) => line.id === move.beforeLineId) : destinationEndIndex(remaining, move.destinationSectionId, staged.sections);
        remaining.splice(at < 0 ? remaining.length : at, 0, ...moved);
        staged.lines = remaining;
        return { changed: move.lineIds };
      }
      const selected = new Set(move.sectionIds);
      const moved = move.sectionIds.map((id) => staged.sections.find((section) => section.id === id)!);
      const remaining = staged.sections.filter((section) => !selected.has(section.id));
      const at = move.beforeSectionId ? remaining.findIndex((section) => section.id === move.beforeSectionId) : remaining.length;
      remaining.splice(at < 0 ? remaining.length : at, 0, ...moved);
      staged.sections = remaining;
      staged.lines = groupedWithSections(staged.lines, staged.sections);
      return { changedFields: move.sectionIds.map((id) => `section:${id}`) };
    }),
  };

  const deleteQuoteLines: AgentTool = {
    name: "delete_quote_lines", label: "Delete Quote Lines",
    description: "Delete 1 to 50 explicitly identified Quote Lines. Deleting all work, a whole section, or the last original line is manual-only.",
    parameters: deleteQuoteLinesParameters, executionMode: "sequential",
    prepareArguments: prepare(deleteQuoteLinesParameters, (args) => { deleteQuoteLinesInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const lineIds = deleteQuoteLinesInput(params, staged);
      const deletedOriginals = lineIds.filter((id) => originalLineIds.has(id));
      if (new Set([...deletedOriginalLineIds, ...deletedOriginals]).size >= originalLineIds.size) reject("destructive_scope_rejected");
      staged.lines = staged.lines.filter((line) => !lineIds.includes(line.id));
      deletedOriginals.forEach((id) => deletedOriginalLineIds.add(id));
      return { changed: lineIds };
    }),
  };

  return {
    tools: [editQuoteDetails, editQuoteLines, editQuoteSections, copyQuoteWork, moveQuoteWork, deleteQuoteLines],
    result: () => ({
      quote: cloneQuote(staged), changed: [...changed], capturedLineIds: [...capturedLineIds],
      ...(changedFields.size ? { changedFields: [...changedFields] } : {}),
      ...(copyFacts.length ? { copyFacts: copyFacts.flatMap((fact) => {
        const line = staged.lines.find((candidate) => candidate.id === fact.lineId);
        return line ? [copyFact(line, fact.quantityUnknown)] : [];
      }) } : {}),
      ...(copyMappings.length ? { copyMappings: [...copyMappings] } : {}),
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
    if (Object.hasOwn(result, "discountMode") || Object.hasOwn(result, "discount")) result.discount = "0";
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

type SectionEdit = { id?: string; title: string };
type CopyWorkInput = {
  measurementPolicy: "retain" | "unknown";
  source: { kind: "lines"; lineIds: string[]; destinationSectionId?: string } | { kind: "section"; sectionId: string; title: string };
};
type MoveWorkInput =
  | { kind: "lines"; lineIds: string[]; destinationSectionId: string; beforeLineId?: string }
  | { kind: "sections"; sectionIds: string[]; beforeSectionId?: string };

function editQuoteSectionsInput(value: unknown, context: EvidenceContext, quote: QuoteData): SectionEdit[] {
  if (!isRecord(value) || !isExactKeys(value, ["sections", "evidence"]) || !Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 50) {
    throw new ToolValidationError("invalid_tool_arguments");
  }
  const ids = new Set<string>();
  const sections = value.sections.map((item, index) => {
    if (!isRecord(item) || !isExactKeys(item, ["id", "title"]) || typeof item.title !== "string" || item.title.length > MAX_SECTION_TITLE) {
      throw new ToolValidationError("invalid_tool_arguments");
    }
    const id = item.id;
    if (id !== undefined && (typeof id !== "string" || !lineIdSyntax(id) || ids.has(id) || !quote.sections.some((section) => section.id === id))) {
      throw new ToolValidationError("invalid_section_id");
    }
    if (id !== undefined) ids.add(id);
    return id === undefined ? { title: item.title } : { id, title: item.title };
  });
  const requiredEvidence = sections.flatMap((section, index) => {
    const existing = section.id ? quote.sections.find((candidate) => candidate.id === section.id) : undefined;
    return section.title && (!existing || existing.title !== section.title) ? [`/sections/${index}/title`] : [];
  });
  assertGroupedEvidence(value.evidence, context, requiredEvidence, (field) => /^\/sections\/(?:0|[1-9]\d*)\/title$/.test(field) && Number(field.split("/")[2]) < sections.length);
  return sections;
}

function copyQuoteWorkInput(value: unknown, context: EvidenceContext, quote: QuoteData): CopyWorkInput {
  if (!isRecord(value) || !isExactKeys(value, ["source", "measurementPolicy", "evidence"]) || !isRecord(value.source)
    || (value.measurementPolicy !== "retain" && value.measurementPolicy !== "unknown")) throw new ToolValidationError("invalid_tool_arguments");
  const source = value.source;
  if (Object.hasOwn(source, "lineIds")) {
    if (!isExactKeys(source, ["lineIds", "destinationSectionId"]) || !Array.isArray(source.lineIds) || source.lineIds.length < 1 || source.lineIds.length > 50) throw new ToolValidationError("invalid_tool_arguments");
    const ids = source.lineIds;
    if (ids.some((id) => typeof id !== "string" || !lineIdSyntax(id)) || new Set(ids).size !== ids.length || ids.some((id) => !quote.lines.some((line) => line.id === id))) throw new ToolValidationError("invalid_line_id");
    if (source.destinationSectionId !== undefined && (typeof source.destinationSectionId !== "string" || source.destinationSectionId.length > 128 || (source.destinationSectionId !== "" && !quote.sections.some((section) => section.id === source.destinationSectionId)))) throw new ToolValidationError("invalid_section_id");
    return { measurementPolicy: value.measurementPolicy, source: { kind: "lines", lineIds: [...ids] as string[], ...(source.destinationSectionId === undefined ? {} : { destinationSectionId: source.destinationSectionId as string }) } };
  }
  if (!isExactKeys(source, ["sectionId", "title"]) || typeof source.sectionId !== "string" || !lineIdSyntax(source.sectionId) || typeof source.title !== "string" || !source.title.length || source.title.length > MAX_SECTION_TITLE || !quote.sections.some((section) => section.id === source.sectionId)) throw new ToolValidationError("invalid_section_id");
  assertGroupedEvidence(value.evidence, context, ["/source/title"], (field) => field === "/source/title");
  return { measurementPolicy: value.measurementPolicy, source: { kind: "section", sectionId: source.sectionId, title: source.title } };
}

function moveQuoteWorkInput(value: unknown, quote: QuoteData): MoveWorkInput {
  if (!isRecord(value) || !isExactRecord(value, ["move"]) || !isRecord(value.move)) throw new ToolValidationError("invalid_tool_arguments");
  const move = value.move;
  if (Object.hasOwn(move, "lineIds")) {
    if (!isExactKeys(move, ["lineIds", "destinationSectionId", "beforeLineId"]) || !Array.isArray(move.lineIds) || move.lineIds.length < 1 || move.lineIds.length > 50 || typeof move.destinationSectionId !== "string" || move.destinationSectionId.length > 128) throw new ToolValidationError("invalid_tool_arguments");
    const ids = move.lineIds;
    if (ids.some((id) => typeof id !== "string" || !lineIdSyntax(id)) || new Set(ids).size !== ids.length || ids.some((id) => !quote.lines.some((line) => line.id === id))) throw new ToolValidationError("invalid_line_id");
    if (move.destinationSectionId !== "" && !quote.sections.some((section) => section.id === move.destinationSectionId)) throw new ToolValidationError("invalid_section_id");
    if (move.beforeLineId !== undefined && (typeof move.beforeLineId !== "string" || !lineIdSyntax(move.beforeLineId) || !quote.lines.some((line) => line.id === move.beforeLineId) || ids.includes(move.beforeLineId) || quote.lines.find((line) => line.id === move.beforeLineId)!.sectionId !== move.destinationSectionId)) throw new ToolValidationError("invalid_move_anchor");
    return { kind: "lines", lineIds: [...ids] as string[], destinationSectionId: move.destinationSectionId, ...(move.beforeLineId === undefined ? {} : { beforeLineId: move.beforeLineId as string }) };
  }
  if (!isExactKeys(move, ["sectionIds", "beforeSectionId"]) || !Array.isArray(move.sectionIds) || move.sectionIds.length < 1 || move.sectionIds.length > 50) throw new ToolValidationError("invalid_tool_arguments");
  const ids = move.sectionIds;
  if (ids.some((id) => typeof id !== "string" || !lineIdSyntax(id)) || new Set(ids).size !== ids.length || ids.some((id) => !quote.sections.some((section) => section.id === id))) throw new ToolValidationError("invalid_section_id");
  if (move.beforeSectionId !== undefined && (typeof move.beforeSectionId !== "string" || !lineIdSyntax(move.beforeSectionId) || !quote.sections.some((section) => section.id === move.beforeSectionId) || ids.includes(move.beforeSectionId))) throw new ToolValidationError("invalid_move_anchor");
  return { kind: "sections", sectionIds: [...ids] as string[], ...(move.beforeSectionId === undefined ? {} : { beforeSectionId: move.beforeSectionId as string }) };
}

function deleteQuoteLinesInput(value: unknown, quote: QuoteData): string[] {
  if (!isExactRecord(value, ["lineIds"]) || !Array.isArray(value.lineIds) || value.lineIds.length < 1 || value.lineIds.length > 50) throw new ToolValidationError("invalid_tool_arguments");
  const ids = value.lineIds;
  if (ids.some((id) => typeof id !== "string" || !lineIdSyntax(id)) || new Set(ids).size !== ids.length || ids.some((id) => !quote.lines.some((line) => line.id === id))) throw new ToolValidationError("invalid_line_id");
  return [...ids] as string[];
}

function assertGroupedEvidence(value: unknown, context: EvidenceContext, requiredFields: readonly string[], fieldAllowed: (field: string) => boolean) {
  if (value === undefined) {
    if (requiredFields.length) throw new ToolValidationError("missing_evidence", requiredFields);
    return;
  }
  if (!Array.isArray(value) || !value.length || value.length > MAX_EVIDENCE) throw new ToolValidationError("invalid_evidence");
  const supported = new Set<string>();
  const invalidEvidenceTextFields: string[] = [];
  const evidenceRepairs: EvidenceRepair[] = [];
  for (const [index, item] of value.entries()) {
    if (!isExactRecord(item, ["fields", "source", "text"]) || !Array.isArray(item.fields) || !item.fields.length || item.fields.length > MAX_EVIDENCE_FIELDS
      || new Set(item.fields).size !== item.fields.length || item.fields.some((field) => typeof field !== "string" || !field || field.length > MAX_EVIDENCE_FIELD || !fieldAllowed(field))
      || typeof item.source !== "string" || !item.source || item.source.length > MAX_EVIDENCE_SOURCE || typeof item.text !== "string" || !item.text || item.text.length > MAX_EVIDENCE_TEXT) throw new ToolValidationError("invalid_evidence");
    const sourceText = evidenceSource(context, item.source);
    if (!evidenceAppears(sourceText, item.text)) {
      invalidEvidenceTextFields.push(`/evidence/${index}/text`);
      const repair = evidenceRepairs.length < MAX_EVIDENCE_REPAIRS ? splitEvidenceRepair(sourceText, item.text) : undefined;
      if (repair) {
        evidenceRepairs.push({ invalidTextField: `/evidence/${index}/text`, source: item.source, ...repair });
      }
    }
    item.fields.forEach((field) => supported.add(field));
  }
  const missingFields = requiredFields.filter((field) => !supported.has(field));
  if (invalidEvidenceTextFields.length || missingFields.length) {
    throw new ToolValidationError(invalidEvidenceTextFields.length ? "evidence_not_found" : "missing_evidence", missingFields, invalidEvidenceTextFields, evidenceRepairs);
  }
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

/** Explain schema failures using declared constraints, never submitted values or raw validator messages. */
function schemaRepairHints(parameters: TSchema, args: unknown): string {
  // TypeBox defaults to eight errors, which can stop halfway through an enum.
  // This collection is synchronous; restore the shared setting before returning.
  const previousLimit = Settings.Get().maxErrors;
  let errors: ReturnType<typeof Errors>;
  try {
    Settings.Set({ maxErrors: 256 });
    errors = Errors(parameters, args);
  } finally {
    Settings.Set({ maxErrors: previousLimit });
  }
  const choices = new Map<string, string[]>();
  for (const error of errors) {
    if (error.keyword === "const") {
      const schema = Pointer.Get(parameters, error.schemaPath.replace(/^#/, "").replace(/\/anyOf\/\d+$/, ""));
      const variants = isRecord(schema) && Array.isArray(schema.anyOf) ? schema.anyOf : [];
      // Read complete choices from the schema, not a potentially capped error list.
      const values = variants.length && variants.every(value => isRecord(value) && Object.hasOwn(value, "const"))
        ? variants.map(value => JSON.stringify(value.const)) : [JSON.stringify(error.params.allowedValue)];
      choices.set(error.instancePath, values);
    }
    if (error.keyword === "enum") choices.set(error.instancePath, error.params.allowedValues.map(value => JSON.stringify(value)));
  }
  // Object alternatives must not report every branch's required fields as mandatory.
  const alternatives = errors.filter(error => error.keyword === "anyOf" && !choices.has(error.instancePath)).map(error => error.instancePath);
  const hints = new Map<string, string>();
  for (const error of errors) {
    // A false additionalProperties schema reports the submitted key in a child error.
    // Only use its parent error, so unknown field names are never echoed.
    if (error.keyword === "boolean" || alternatives.some(path => error.instancePath.startsWith(`${path}/`))) continue;
    const path = error.instancePath || "/";
    let reason: string;
    const allowed = choices.get(error.instancePath);
    if (allowed) reason = `must be ${[...new Set(allowed)].join(" or ")}`;
    else if (alternatives.includes(error.instancePath)) reason = "must match one of the tool's permitted argument forms";
    else if (error.keyword === "required") {
      for (const field of error.params.requiredProperties) {
        const requiredPath = `${error.instancePath}/${field}`;
        hints.set(requiredPath, `${requiredPath} is required`);
      }
      continue;
    } else if (error.keyword === "type") reason = `must be ${error.params.type}`;
    else if (error.keyword === "additionalProperties") reason = "contains unsupported fields; use only the fields declared by this tool";
    else reason = `must satisfy the declared ${error.keyword} constraint`;
    hints.set(path, `${path} ${reason}`);
  }
  if (!hints.size) return "";
  return ` Invalid fields: ${[...hints.values()].slice(0, 12).join("; ")}.${hints.size > 12 || errors.length >= 256 ? " Further schema errors were omitted." : ""} Resubmit the complete call, including its evidence.`;
}

function splitEvidenceRepair(sourceText: string, evidenceText: string): Pick<EvidenceRepair, "excerpts" | "escapedWhitespace"> | undefined {
  const whitespaceParts = evidenceText.split(ESCAPED_WHITESPACE);
  // Diagnose escaping only when that change alone produces a source-contained excerpt.
  // This is a repair proposal, never an additional acceptance rule.
  const escapedWhitespace = whitespaceParts.length > 1 && evidenceAppears(sourceText, whitespaceParts.join(" "));
  const excerpts = escapedWhitespace ? whitespaceParts : evidenceText.includes("...")
    ? evidenceText.split("...")
    : evidenceText.includes("…")
      ? evidenceText.split("…")
      : evidenceText.split(/(?<=[.!?])\s+/u);
  const trimmed = excerpts.map((excerpt) => excerpt.trim());
  if (trimmed.length < 2 || trimmed.length > MAX_EVIDENCE_REPAIR_PARTS || trimmed.some((excerpt) => !excerpt || excerpt.length > MAX_EVIDENCE_REPAIR_EXCERPT)) return undefined;
  return trimmed.every((excerpt) => evidenceAppears(sourceText, excerpt)) ? { excerpts: trimmed, escapedWhitespace } : undefined;
}

function toolErrorMessage(code: string, details?: ToolValidationError): string {
  const missingEvidenceFields = details?.missingEvidenceFields ?? [];
  const invalidEvidenceTextFields = details?.invalidEvidenceTextFields ?? [];
  const evidenceRepairs = details?.evidenceRepairs ?? [];
  const messages: Record<string, string> = {
    invalid_tool_arguments: "The tool arguments are invalid. Resubmit the complete call with the required fields.",
    missing_evidence: "Each changed nonempty commercial fact needs a citation from an application-supplied source.",
    evidence_not_found: "The evidence excerpt was not found in the cited application-supplied source.",
    unknown_evidence_source: "The evidence source is not available in the current application context.",
    reference_locked: "The Quote reference is fixed after first Publication and cannot be changed.",
    discount_not_applicable: "A nonzero discount cannot be used when discountMode is none.",
    invalid_mode_fields: "Supply empty strings for fields unused by the selected pricing mode.",
    invalid_line_id: "Use each existing stable Quote Line ID at most once; omit id to create a line.",
    invalid_section_id: "The target Section ID is unknown or not allowed for this operation.",
    invalid_move_anchor: "The move anchor must be an unselected item in the requested destination.",
    bulk_limit_exceeded: "This batch exceeds the structural operation limit of 50 items.",
    ambiguous_measurement: "The copied description contains an unrecognised measurement. Clarify that measurement before copying with unknown values.",
    destructive_scope_rejected: "Deleting all work is manual-only. Use the manual Quote controls; no changes from this assistant turn were applied.",
    draft_payload_limit: "The Working Draft is too large for this change. Continue manually.",
  };
  const repair = missingEvidenceFields.length
    ? ` Missing evidence fields: ${missingEvidenceFields.join(", ")}. Resubmit the complete call with evidence entries containing fields, source and text. Add these fields to citations with supporting exact excerpts; one citation may cover several fields.`
    : "";
  const excerpts = invalidEvidenceTextFields.length
    ? ` Invalid evidence text: ${invalidEvidenceTextFields.slice(0, 12).join(", ")}.${invalidEvidenceTextFields.length > 12 ? " Further invalid excerpts were omitted." : ""} Copy exact contiguous excerpts from the cited source. Use separate citations for separate passages, without inserting ellipses or other text.`
    : "";
  const suggestedRepairs = evidenceRepairs.length
    ? ` ${evidenceRepairs.map((repair) => `${repair.escapedWhitespace ? "The citation contains literal JSON whitespace escapes instead of source whitespace. Copy decoded source text, preferably one paragraph per citation. " : ""}Suggested exact excerpts for ${repair.invalidTextField}: ${repair.excerpts.map((excerpt) => JSON.stringify(excerpt)).join(" | ")}. Keep source ${JSON.stringify(repair.source)} and submit separate evidence entries, assigning each only the fields it supports.`).join(" ")}`
    : "";
  const completeResubmission = invalidEvidenceTextFields.length
    ? " Invalid excerpt: this call was not applied. Resubmit the COMPLETE call with unchanged valid citations and coverage for every required field."
    : "";
  return `Tool input rejected. Reason: ${code}. ${messages[code] ?? "Check its target and values, then resubmit the complete call."}${excerpts}${suggestedRepairs}${repair}${completeResubmission}`;
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
function newSectionId(quote: QuoteData): string { const ids = new Set(quote.sections.map((section) => section.id)); for (let attempt = 0; attempt < 10; attempt += 1) { const id = `section-${randomUUID()}`; if (!ids.has(id)) return id; } throw new Error("invalid"); }
function insertAfterSource(lines: QuoteLine[], sourceId: string, copy: QuoteLine, sections: { id: string }[]): QuoteLine[] {
  const source = lines.find((line) => line.id === sourceId)!;
  if (copy.sectionId === source.sectionId) {
    const result = [...lines];
    result.splice(result.findIndex((line) => line.id === sourceId) + 1, 0, copy);
    return result;
  }
  return insertAtDestinationEnd(lines, copy, sections);
}
function insertAtDestinationEnd(lines: QuoteLine[], line: QuoteLine, sections: { id: string }[]): QuoteLine[] {
  const result = [...lines];
  result.splice(destinationEndIndex(result, line.sectionId, sections), 0, line);
  return result;
}
function destinationEndIndex(lines: QuoteLine[], sectionId: string, sections: { id: string }[]): number {
  const destination = sectionId === "" ? -1 : sections.findIndex((section) => section.id === sectionId);
  for (let index = 0; index < lines.length; index += 1) {
    const rank = lines[index].sectionId === "" ? -1 : sections.findIndex((section) => section.id === lines[index].sectionId);
    if (rank > destination) return index;
  }
  return lines.length;
}
function groupedWithSections(lines: QuoteLine[], sections: { id: string }[]): QuoteLine[] { return [...lines.filter((line) => line.sectionId === ""), ...sections.flatMap((section) => lines.filter((line) => line.sectionId === section.id)), ...lines.filter((line) => line.sectionId !== "" && !sections.some((section) => section.id === line.sectionId))]; }
function copyLine(source: QuoteLine, id: string, sectionId: string, unknownMeasurements: boolean): QuoteLine {
  const copy = { ...source, id, sectionId };
  if (unknownMeasurements) {
    if (source.mode === "quantity") {
      copy.quantity = "";
      copy.amount = "";
    }
    copy.description = withoutMeasurement(copy.description);
    if (/\b\d+(?:[.,]\d+)?\s+[A-Za-zÀ-ÿ²³]+/u.test(copy.description)) throw new ToolValidationError("ambiguous_measurement");
  }
  return copy;
}
function copyFact(line: QuoteLine, quantityUnknown: boolean): CopyFact { return { lineId: line.id, mode: line.mode, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount, quantityUnknown }; }
function withoutMeasurement(description: string): string { return description.replace(/\b\d+(?:[.,]\d+)?\s*(?:[x×/]\s*\d+(?:[.,]\d+)?)+(?:\s*(?:m|cm|mm))?\b/giu, "").replace(/\b\d+(?:[.,]\d+)?\s*(?:m²|m2|cm|mm|km|m|kg|g|l|cl|ml|h|heures?|jours?|pce|pièces?|mètres? carrés?|metres? carres?|mètres? cubes?|metres? cubes?|square meters?|square metres?|cubic meters?|cubic metres?|sq\.?\s*m|pieds?|feet|litres?|liters?|kilogrammes?|kilograms?)(?=$|[^A-Za-zÀ-ÿ²³])/giu, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/([(:])\s+/g, "$1").trim(); }
function evidenceAppears(text: string, evidence: string): boolean { const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase(); return compact(text).includes(compact(evidence)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
/** Allows optional schema properties while rejecting unknown keys. */
function isExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
