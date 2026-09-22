// Approved model-facing definition used by the commercial assistant executor.
// Derived inputs are model-calculated; no calculation-specific arguments.
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
        'Use "current" for currentMessage.text, not "currentMessage" or "currentMessage.text". Use a supplied history_N ID for an earlier Artisan message. quote.FIELD refers only to that field in the supplied currentWorkingDraft; quote.title contains the existing Quote title, not the Artisan message. line:ID.FIELD and section:ID.FIELD refer to existing supplied work by stable ID. Never invent a source ID or cite an assistant message.',
    }),
    text: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        'Copy an exact excerpt from the selected source. For source "current", copy from currentMessage.text, not from the Quote title or your proposed output. If you mistakenly cited currentMessage, change the source to current and keep the exact message excerpt. One citation may cover several fields when the excerpt supports every listed field.',
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

export const editQuoteLinesDescription =
  "Create or edit Quote Lines. The schema allows up to 50 lines, but that is not a target batch size. " +
  "Each response has a 4096-token output limit, including tool arguments and evidence. " +
  "For long requests, use batches of about 5 lines, fewer for long descriptions or citations. " +
  "Send only one batch per response and wait for its tool result before the next batch; do not bundle several batches into one response. " +
  "Continue until all supplied work is captured, without recreating lines from accepted batches. " +
  "Keep the supplied work order and section assignments across batches. " +
  "Evidence indexes restart at /lines/0 in every call. Group supported fields in one citation instead of repeating its excerpt. " +
  "Keep complete descriptions and evidence; reduce batch size instead of omitting facts. " +
  "Supply each line's complete description and pricing information. " +
  "Include its existing ID to edit it; omit the ID to create a new line. " +
  "Preserve unchanged values from the current draft. " +
  "Use empty strings for unknown values, deliberately cleared values " +
  "and fields unused by the selected pricing mode. " +
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
