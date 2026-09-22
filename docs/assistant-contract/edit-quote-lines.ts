// Approved model-facing definition used by the commercial assistant executor.
// Derived inputs are model-calculated; no calculation-specific arguments.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const lineId = Type.String({
  maxLength: 128,
  pattern: "^(?:[A-Za-z0-9][A-Za-z0-9_-]*)?$",
  description: "Omit to create a line. For compatibility, an empty string is also treated as omitted. Non-empty values must be an existing stable line ID.",
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
    ], {
      description:
        'Use "fixed" for a forfait or one stated total; amount is a field, never a mode. Use "quantity" for per-unit pricing; leave an unknown quantity or unit price as an empty string.',
    }),
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

export const editQuoteLinesParameters = Type.Object(
  {
    lines: Type.Array(line, { minItems: 1, maxItems: 50 }),
  },
  { additionalProperties: false },
);

export type EditQuoteLinesArguments = Static<typeof editQuoteLinesParameters>;

type EditQuoteLinesTool = AgentTool<typeof editQuoteLinesParameters, unknown>;

export const editQuoteLinesDescription =
  "Create or edit Quote Lines. The schema allows up to 50 lines, but that is not a target batch size. " +
  "Each response has a 4096-token output limit, including tool arguments. " +
  "For long requests, use batches of about 5 lines, fewer for long descriptions. " +
  "Send only one batch per response and wait for its tool result before the next batch; do not bundle several batches into one response. " +
  "Continue until all supplied work is captured, without recreating lines from accepted batches. " +
  "Keep the supplied work order and section assignments across batches. " +
  "Keep complete descriptions; reduce batch size instead of omitting facts. " +
  "Supply each line's complete description and pricing information. " +
  "Include its existing ID to edit it; omit the ID to create a new line. " +
  "Preserve unchanged values from the current draft. " +
  "Use empty strings for unknown values, deliberately cleared values " +
  "and fields unused by the selected pricing mode. " +
  "Write new Quote Line descriptions in French, even for an English interface. " +
  'Use mode "fixed" for a forfait or one stated total; "amount" is a field, never a mode. ' +
  'Use mode "quantity" for per-unit pricing. ' +
  "Do not copy, move or delete lines with this tool.";

export function createEditQuoteLinesTool(
  execute: EditQuoteLinesTool["execute"],
): EditQuoteLinesTool {
  return {
    name: "edit_quote_lines",
    label: "Edit Quote lines",
    description: editQuoteLinesDescription,
    parameters: editQuoteLinesParameters,
    executionMode: "sequential",
    execute,
  };
}
