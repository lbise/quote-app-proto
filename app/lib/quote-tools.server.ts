import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";
import { Errors, Pointer } from "typebox/value";
import { Settings } from "typebox/system";

import {
  editQuoteLinesDescription,
  editQuoteLinesParameters,
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

class ToolValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type CreateQuoteToolsInput = {
  quote: QuoteData;
  capturedLineIds: readonly string[];
  /** A published Quote's reference cannot be changed. */
  referenceLocked?: boolean;
  /** Optional runner-owned preflight for the next application context. */
  validateStaged?: (quote: QuoteData) => string | undefined;
};

const MAX_DETAIL_TEXT = 20_000;
const MAX_LINE_DESCRIPTION = 20_000;
const MAX_SECTION_TITLE = 4_000;
const MAX_UNIT = 100;
const MAX_DECIMAL = 20;
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
}, { additionalProperties: false });

const editQuoteSectionsParameters = Type.Object({
  sections: Type.Array(Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" })),
    title: Type.String({ maxLength: MAX_SECTION_TITLE }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
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
type Mutation = { changed?: string[]; changedFields?: string[] };
type EditableLine = Omit<QuoteLine, "id" | "sectionId"> & { id?: string; sectionId?: string };

export function createQuoteTools(input: CreateQuoteToolsInput): {
  tools: AgentTool[];
  result(): QuoteToolsResult;
  diagnostic(): QuoteToolsDiagnostic | undefined;
} {
  assertInitialInput(input);
  const staged = cloneQuote(input.quote);
  const capturedLineIds = [...new Set(input.capturedLineIds.filter((id) => staged.lines.some((line) => line.id === id)))];
  const changed = new Set<string>();
  const changedFields = new Set<string>();
  const copyFacts: CopyFact[] = [];
  const copyMappings: { sourceId: string; newId: string }[] = [];
  const deletedOriginalLineIds = new Set<string>();
  const originalLineIds = new Set(input.quote.lines.map((line) => line.id));
  let lastErrorCode: string | undefined;

  const reject = (code = "invalid_tool_input", schemaHints = ""): never => {
    lastErrorCode = code;
    throw new Error(toolErrorMessage(code) + schemaHints);
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
      throw new Error(toolErrorMessage(lastErrorCode));
    }
  };

  const prepare = (parameters: TSchema, validate: (args: unknown) => void) => (args: unknown) => {
    try { validate(args); return args; } catch (error) {
      lastErrorCode = error instanceof ToolValidationError ? error.code : "invalid_tool_arguments";
      return reject(lastErrorCode, schemaRepairHints(parameters, args));
    }
  };

  const editQuoteDetails: AgentTool = {
    name: "edit_quote_details",
    label: "Edit Quote details",
    description: "Edit the current Working Draft's reference, project title, dates, work-site address, Customer and business details, terms, VAT registration and identifier, or discount. Include only fields to change. Use an empty string to clear a text or decimal field. Do not supply calculated totals, currency or VAT rates.",
    parameters: editQuoteDetailsParameters,
    executionMode: "sequential",
    prepareArguments: prepare(editQuoteDetailsParameters, (args) => { editQuoteDetailsInput(args, staged, input.referenceLocked ?? false); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const fields = editQuoteDetailsInput(params, staged, input.referenceLocked ?? false);
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
    prepareArguments: prepare(editQuoteLinesParameters, (args) => { editQuoteLinesInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const lines = editQuoteLinesInput(params, staged);
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
    description: "Create or rename up to 50 Quote Sections. Include an existing stable ID to rename it; omit the ID to create a section at the end. An empty title leaves an incomplete section and never deletes it. Write new titles in French. Do not add, edit, move, copy or delete Quote Lines with this tool. Do not move, copy or delete sections with this tool.",
    parameters: editQuoteSectionsParameters, executionMode: "sequential",
    prepareArguments: prepare(editQuoteSectionsParameters, (args) => { editQuoteSectionsInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const sections = editQuoteSectionsInput(params, staged);
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
    prepareArguments: prepare(copyQuoteWorkParameters, (args) => { copyQuoteWorkInput(args, staged); }),
    execute: async (_toolCallId, params, signal) => mutate(signal, () => {
      const copyInput = copyQuoteWorkInput(params, staged);
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

function editQuoteDetailsInput(value: unknown, quote: QuoteData, referenceLocked: boolean): Partial<Pick<QuoteData, DetailField>> {
  if (!isRecord(value) || !isExactKeys(value, ["fields"]) || !isRecord(value.fields)) throw new ToolValidationError("invalid_tool_arguments");
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
  const nextMode = result.discountMode ?? quote.discountMode;
  if (nextMode === "none") {
    if (Object.hasOwn(result, "discount") && typeof result.discount === "string" && result.discount !== "" && !isZeroDecimal(result.discount)) {
      throw new ToolValidationError("discount_not_applicable");
    }
    if (Object.hasOwn(result, "discountMode") || Object.hasOwn(result, "discount")) result.discount = "0";
  } else if (Object.hasOwn(result, "discountMode") && result.discountMode !== quote.discountMode && !Object.hasOwn(result, "discount")) {
    result.discount = "";
  }
  return result;
}

function editQuoteLinesInput(value: unknown, quote: QuoteData): EditableLine[] {
  if (!isRecord(value) || !isExactKeys(value, ["lines"]) || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 50) throw new ToolValidationError("invalid_tool_arguments");
  const ids = new Set<string>();
  const lines = value.lines.map((item, index) => {
    if (!isRecord(item) || !isExactKeys(item, ["id", "sectionId", "description", "mode", "quantity", "unit", "unitPrice", "amount"])
      || !Object.hasOwn(item, "description") || !Object.hasOwn(item, "mode") || !Object.hasOwn(item, "quantity") || !Object.hasOwn(item, "unit") || !Object.hasOwn(item, "unitPrice") || !Object.hasOwn(item, "amount")) throw new ToolValidationError("invalid_tool_arguments");
    const id = item.id === "" ? undefined : item.id;
    if (id !== undefined && (typeof id !== "string" || !lineIdSyntax(id) || ids.has(id) || !quote.lines.some((line) => line.id === id))) throw new ToolValidationError("invalid_line_id");
    if (id !== undefined) ids.add(id);
    if (item.sectionId !== undefined && (id !== undefined || typeof item.sectionId !== "string" || item.sectionId.length > 128 || (item.sectionId !== "" && !quote.sections.some((section) => section.id === item.sectionId)))) throw new ToolValidationError("invalid_section_id");
    if (typeof item.description !== "string" || item.description.length > MAX_LINE_DESCRIPTION || (item.mode !== "quantity" && item.mode !== "fixed")
      || typeof item.quantity !== "string" || !boundedDecimal(item.quantity, 3) || typeof item.unit !== "string" || item.unit.length > MAX_UNIT
      || typeof item.unitPrice !== "string" || !boundedDecimal(item.unitPrice, 2) || typeof item.amount !== "string" || !boundedDecimal(item.amount, 2)) throw new ToolValidationError("invalid_tool_arguments");
    if ((item.mode === "quantity" && item.amount !== "") || (item.mode === "fixed" && (item.quantity !== "" || item.unit !== "" || item.unitPrice !== ""))) throw new ToolValidationError("invalid_mode_fields");
    return { ...(id === undefined ? {} : { id }), ...(item.sectionId === undefined ? {} : { sectionId: item.sectionId }), description: item.description, mode: item.mode, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, amount: item.amount } as EditableLine;
  });
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

function editQuoteSectionsInput(value: unknown, quote: QuoteData): SectionEdit[] {
  if (!isRecord(value) || !isExactKeys(value, ["sections"]) || !Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 50) {
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
  return sections;
}

function copyQuoteWorkInput(value: unknown, quote: QuoteData): CopyWorkInput {
  if (!isRecord(value) || !isExactKeys(value, ["source", "measurementPolicy"]) || !isRecord(value.source)
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
  return ` Invalid fields: ${[...hints.values()].slice(0, 12).join("; ")}.${hints.size > 12 || errors.length >= 256 ? " Further schema errors were omitted." : ""} Resubmit the complete call.`;
}

function toolErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    invalid_tool_arguments: "The tool arguments are invalid. Resubmit the complete call with the required fields.",
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
  return `Tool input rejected. Reason: ${code}. ${messages[code] ?? "Check its target and values, then resubmit the complete call."}`;
}

function restoreQuote(target: QuoteData, source: QuoteData) { Object.assign(target, source, { sections: source.sections.map((section) => ({ ...section })), lines: source.lines.map((line) => ({ ...line })) }); }
function cloneQuote(quote: QuoteData): QuoteData { return { ...quote, sections: quote.sections.map((section) => ({ ...section })), lines: quote.lines.map((line) => ({ ...line })) }; }

function assertInitialInput(input: CreateQuoteToolsInput) {
  if (!Array.isArray(input.capturedLineIds)) throw new Error("Tool input rejected.");
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
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
/** Allows optional schema properties while rejecting unknown keys. */
function isExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
