// Approved model-facing review artifact. This file is not registered by app/.
// Derived inputs are model-calculated; no calculation-specific arguments.
// The application executor is not implemented by this review artifact.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const lineId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
});

const decimalOrEmpty = Type.String({
  maxLength: 20,
  pattern: "^$|^[0-9]+([.,][0-9]+)?$",
  description:
    "Decimal without units or currency. Use an empty string for an unknown, cleared or unused value.",
});

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
    description: Type.String({ maxLength: 20000 }),
    mode: Type.Union([
      Type.Literal("quantity"),
      Type.Literal("fixed"),
    ]),
    quantity: decimalOrEmpty,
    unit: Type.String({ maxLength: 100 }),
    unitPrice: decimalOrEmpty,
    amount: decimalOrEmpty,
  },
  {
    additionalProperties: false,
    description:
      "Complete line content. Quantity pricing uses quantity, unit and unitPrice; amount must be empty. Fixed pricing uses amount; quantity, unit and unitPrice must be empty.",
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
          "Input fields supported by this citation, such as /lines/0/quantity and /lines/0/unitPrice.",
      },
    ),
    source: Type.String({
      minLength: 1,
      maxLength: 256,
      description:
        "Application-supplied source: current, history_N, quote.FIELD, line:ID.FIELD or section:ID.FIELD. Never cite an assistant message.",
    }),
    text: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "Exact excerpt from the source. One citation may support several fields.",
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
          "Cite sources for new nonempty commercial facts. Unchanged values and deliberate clearing do not need new evidence.",
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
      "Supply each line's complete description and pricing information. " +
      "Include its existing ID to edit it; omit the ID to create a new line. " +
      "Preserve unchanged values from the current draft. " +
      "Use empty strings for unknown values, deliberately cleared values " +
      "and fields unused by the selected pricing mode. " +
      "Do not copy, move or delete lines with this tool.",
    parameters: editQuoteLinesParameters,
    executionMode: "sequential",
    execute,
  };
}
