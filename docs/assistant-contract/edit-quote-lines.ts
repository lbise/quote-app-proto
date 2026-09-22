// Approved model-facing definition used by the commercial assistant executor.
// Derived inputs are model-calculated; no calculation-specific arguments.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const lineId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
});

function decimalOrEmpty(description: string) {
  return Type.String({
    maxLength: 20,
    pattern: "^$|^[0-9]+([.,][0-9]+)?$",
    description,
  });
}

const line = Type.Object(
  {
    id: Type.Optional(lineId),
    sectionId: Type.Optional(
      Type.String({
        maxLength: 128,
        description:
          "For new lines only: destination section ID. Omit or use an empty string for No section.",
      }),
    ),
    description: Type.String({
      maxLength: 20000,
      description:
        "The complete current work description. Cite it when a new or changed nonempty description is supplied.",
    }),
    mode: Type.Union([
      Type.Literal("quantity"),
      Type.Literal("fixed"),
    ], {
      description:
        "quantity uses quantity, unit and unitPrice. fixed uses amount. Cite /lines/N/mode for every new line or changed mode.",
    }),
    quantity: decimalOrEmpty(
      "Quantity without a unit. Use only with quantity mode; otherwise send an empty string. Cite /lines/N/quantity when changed and nonempty.",
    ),
    unit: Type.String({
      maxLength: 100,
      description:
        "Unit for quantity mode, such as m² or h. Send an empty string for fixed mode. Cite /lines/N/unit when changed and nonempty.",
    }),
    unitPrice: decimalOrEmpty(
      "Unit price without currency. Use only with quantity mode; otherwise send an empty string. Cite /lines/N/unitPrice when changed and nonempty.",
    ),
    amount: decimalOrEmpty(
      "Fixed amount without currency. Use only with fixed mode; otherwise send an empty string. Cite /lines/N/amount when changed and nonempty.",
    ),
  },
  {
    additionalProperties: false,
    description:
      "Complete line content. Send every field on every create or edit. Quantity pricing uses quantity, unit and unitPrice and leaves amount empty. Fixed pricing uses amount and leaves quantity, unit and unitPrice empty. Cite each changed nonempty commercial value.",
  },
);

const evidence = Type.Object(
  {
    fields: Type.Array(
      Type.String({ minLength: 1, maxLength: 160 }),
      {
        minItems: 1,
        maxItems: 200,
        uniqueItems: true,
        description:
          "Line JSON Pointer targets supported by this citation, such as /lines/0/quantity and /lines/0/unitPrice. One citation may name every field supported by its excerpt.",
      },
    ),
    source: Type.String({
      minLength: 1,
      maxLength: 256,
      description:
        "Application-supplied source only: current, history_N, quote.FIELD, line:ID.FIELD or section:ID.FIELD. Never cite an assistant message.",
    }),
    text: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "Exact literal excerpt from source. Do not paraphrase it. One citation may support several fields.",
    }),
  },
  { additionalProperties: false },
);

export const editQuoteLinesParameters = Type.Object(
  {
    lines: Type.Array(line, { minItems: 1, maxItems: 50 }),
    evidence: Type.Optional(
      Type.Array(evidence, {
        minItems: 1,
        maxItems: 200,
        description:
          "Grouped citations. Cite /lines/N/mode for every new line or changed mode, and every changed nonempty description, quantity, unit, unitPrice or amount. No citation is needed for unchanged values, cleared values or structural IDs.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type EditQuoteLinesArguments = Static<typeof editQuoteLinesParameters>;

type EditQuoteLinesTool = AgentTool<typeof editQuoteLinesParameters, unknown>;

export function createEditQuoteLinesTool(
  execute: EditQuoteLinesTool["execute"],
): EditQuoteLinesTool {
  return {
    name: "edit_quote_lines",
    label: "Edit Quote lines",
    description:
      "Create or edit up to 50 Quote Lines in one call. " +
      "Send every line field: include an existing ID to edit it, or omit ID to create it. " +
      "Preserve unchanged values and use empty strings only for unknown, cleared or mode-incompatible values. " +
      "For evidence, group supported JSON Pointer fields under one exact excerpt from current, history_N or an original-draft source. " +
      "Every new line or changed mode needs /lines/N/mode; every changed nonempty description, quantity, unit, unitPrice or amount needs evidence. " +
      "Do not cite unchanged values, cleared values or structural IDs. Do not copy, move or delete lines with this tool.",
    parameters: editQuoteLinesParameters,
    executionMode: "sequential",
    execute,
  };
}
