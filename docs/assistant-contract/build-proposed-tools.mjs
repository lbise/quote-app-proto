// Review artifact only. Nothing in app/ imports or registers these definitions.
// Run from the repo root: node docs/assistant-contract/build-proposed-tools.mjs
import { writeFileSync } from "node:fs";

const text = (maxLength, description) => ({ type: "string", maxLength, ...(description ? { description } : {}) });
const choice = (...values) => ({ type: "string", enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const list = (items, maxItems = 50) => ({ type: "array", items, minItems: 1, maxItems });
const id = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" };
const group = { ...text(128), description: "Existing Quote Section ID, or the empty string for No section." };
const decimal = { ...text(20), pattern: "^[0-9]+([.,][0-9]+)?$", description: "Non-negative decimal without units. Application validation enforces field precision and range." };
const value = { ...text(20), pattern: "^$|^[0-9]+([.,][0-9]+)?$", description: "Decimal without units, or the empty string to deliberately clear the value. Missing is not zero." };
const correctionOf = { type: "string", minLength: 1, maxLength: 128, description: "When correcting a rejected call, copy its failureId here. Omit for a new operation. A correction replaces the entire rejected call and counts against the turn-wide limit of three correction attempts." };
const evidence = list(object({
  path: text(160, "JSON Pointer to the input field supported by this evidence, including its operation index."),
  source: { anyOf: [
    object({ kind: choice("artisan_message"), messageId: id, excerpt: { ...text(2000), minLength: 1 } }),
    object({ kind: choice("current_work"), entity: choice("quote", "line", "section"), id, field: text(64), excerpt: { ...text(2000), minLength: 1 } }, ["kind", "entity", "field", "excerpt"]),
  ] },
}), 200);
const roomWallArea = object({ kind: choice("room_wall_area"), length: decimal, width: decimal, height: decimal });
const pricingFields = {
  description: text(20000, "Faithful French commercial wording of supplied work. Empty clears it and leaves the draft incomplete."),
  mode: choice("quantity", "fixed"), quantity: value, unit: text(100), unitPrice: value, amount: value,
  quantityCalculation: roomWallArea,
};
const tool = (name, description, properties, required) => ({ name, description, parameters: object({ ...properties, correctionOf }, required) });
const tools = [
  tool("edit_quote", "Edit named commercial fields of this Working Draft only. Omitted fields stay unchanged; empty strings deliberately clear text or decimal fields. Customer and business details are Quote-local copies, never reusable records. The reference is locked after first Publication. Do not supply computed amounts, currency or a tax rate. Provide evidence for new commercial facts. The complete call validates before staging any change.", {
    fields: { ...object({
      reference: text(200), title: text(20000), issueDate: text(10, "YYYY-MM-DD or empty."), validUntil: text(10, "YYYY-MM-DD or empty."),
      siteAddress: text(20000), customerName: text(20000), customerAddress: text(20000), customerContact: text(20000),
      businessName: text(20000), businessAddress: text(20000), businessContact: text(20000), terms: text(20000),
      vatRegistered: { anyOf: [{ type: "boolean" }, { type: "null" }], description: "True applies the supported standard VAT treatment, false means not registered, null means unknown. Never infer registration." },
      vatId: text(20000), discountMode: choice("none", "percent", "fixed"), discount: value,
    }, []), minProperties: 1 }, evidence,
  }, ["fields"]),
  tool("edit_lines", "Add, correct or adjust explicitly selected Quote Lines, including manually entered lines. A call contains at most 50 operations and touches at most 50 lines. Operations validate together or change nothing. Add requires description and mode; unknown values stay empty. Updates omit unchanged fields and use empty strings to clear. Changing pricing mode clears obsolete fields and leaves unsupplied replacement prices missing. Adjust uses application decimal arithmetic and CHF half-up rounding, not model-computed replacement prices. No copying, moving or deleting through this tool. Provide evidence for new commercial facts and supplied adjustment percentages.", {
    operations: list({ anyOf: [
      object({ op: choice("add"), sectionId: group, fields: object(pricingFields, ["description", "mode"]) }, ["op", "fields"]),
      object({ op: choice("update"), lineId: id, fields: { ...object(pricingFields, []), minProperties: 1 } }),
      object({ op: choice("adjust"), lineIds: { ...list(id), uniqueItems: true }, field: choice("unitPrice", "amount"), direction: choice("increase", "decrease"), percent: decimal }),
    ] }), evidence,
  }, ["operations"]),
  tool("edit_sections", "Create or rename Quote Sections using faithful French titles. Omitted values are unchanged. At most 50 operations per call. New sections append and receive application-generated IDs. Use the returned ID in a later call to add or move lines into a new section. This tool cannot move, copy or delete work. The whole call validates before staging any change.", {
    operations: list({ anyOf: [
      object({ op: choice("add"), title: { ...text(4000), minLength: 1 } }),
      object({ op: choice("rename"), sectionId: id, title: text(4000, "Empty deliberately clears the title and leaves the draft incomplete.") }),
    ] }), evidence,
  }, ["operations"]),
  tool("copy_work", "Explicitly copy existing lines or a section. New work receives fresh application IDs. A line copy appends to the named destination, or immediately follows its source when destinationSectionId is omitted. A section copy follows its source section. Source values remain unchanged. Use measurementPolicy unknown when copied measurements are not known; affected quantities and uncertain embedded measurements are removed, while other supplied values remain. If safe removal is ambiguous, the call fails for clarification. Review the returned retained/missing values. A call may create at most 50 lines and one section and either succeeds completely or changes nothing.", {
    source: { anyOf: [
      object({ kind: choice("lines"), lineIds: { ...list(id), uniqueItems: true }, destinationSectionId: group }, ["kind", "lineIds"]),
      object({ kind: choice("section"), sectionId: id, title: { ...text(4000), minLength: 1 } }),
    ] }, measurementPolicy: choice("retain", "unknown"), evidence,
  }, ["source", "measurementPolicy"]),
  tool("move_work", "Explicitly move or reorder selected lines or sections using stable IDs. Array order is the requested relative order. For lines, destinationSectionId is required; beforeLineId must be an unselected line already in that destination. Omit beforeLineId to append. For sections, beforeSectionId must be unselected; omit it to append. No section remains first. Unselected work retains relative order. The complete call validates before staging any change; at most 50 selected lines or sections.", {
    move: { anyOf: [
      object({ kind: choice("lines"), lineIds: { ...list(id), uniqueItems: true }, destinationSectionId: group, beforeLineId: id }, ["kind", "lineIds", "destinationSectionId"]),
      object({ kind: choice("sections"), sectionIds: { ...list(id), uniqueItems: true }, beforeSectionId: id }, ["kind", "sectionIds"]),
    ] },
  }, ["move"]),
  tool("delete_work", "Explicitly remove identified work. Delete ordinary selected lines or empty sections directly where authorized. Deleting a populated section removes its contained lines and requires application-controlled confirmation; clear_all does too. A sequence that effectively clears all original work or empties a populated section before deleting it also requires confirmation. No part of a confirmation-required turn commits before UI confirmation. Conversational yes is not authorization. This tool only stages a proposal, never confirms it. All targets validate together or no staged work changes.", {
    target: { anyOf: [
      object({ kind: choice("lines"), lineIds: { ...list(id), uniqueItems: true } }),
      object({ kind: choice("sections"), sectionIds: { ...list(id), uniqueItems: true } }),
      object({ kind: choice("clear_all") }),
    ] },
  }, ["target"]),
];
writeFileSync(new URL("./proposed-tools.json", import.meta.url), `${JSON.stringify(tools, null, 2)}\n`);
