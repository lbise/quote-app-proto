// Review artifact only. Nothing in app/ imports or registers these definitions.
// Run from the repo root: node docs/assistant-contract/build-proposed-tools.mjs
import { writeFileSync } from "node:fs";
import { createEditQuoteLinesTool } from "./edit-quote-lines.ts";

const approvedLineTool = createEditQuoteLinesTool(async () => {
  throw new Error("Review artifact only; no executor is implemented here.");
});

const text = (maxLength, description) => ({ type: "string", maxLength, ...(description ? { description } : {}) });
const choice = (...values) => ({ type: "string", enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const list = (items, maxItems = 50) => ({ type: "array", items, minItems: 1, maxItems });
const id = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" };
const sectionIdOrNoSection = { ...text(128), description: "Existing Quote Section ID, or the empty string for No section." };
const clearableDecimal = { ...text(20), pattern: "^$|^[0-9]+([.,][0-9]+)?$", description: "Decimal without units, or the empty string to deliberately clear the value. Missing is not zero." };
const tool = (name, description, properties, required) => ({ name, description, parameters: object(properties, required) });
const tools = [
  tool("edit_quote_details", "Edit the current Working Draft's reference, project title, dates, work-site address, Customer and business details, terms, VAT registration and identifier, or discount. Include only fields to change. Use an empty string to clear a text or decimal field. Do not supply calculated totals, currency or VAT rates.", {
    fields: { ...object({
      reference: text(200), title: text(20000), issueDate: text(10, "YYYY-MM-DD or empty."), validUntil: text(10, "YYYY-MM-DD or empty."),
      siteAddress: text(20000), customerName: text(20000), customerAddress: text(20000), customerContact: text(20000),
      businessName: text(20000), businessAddress: text(20000), businessContact: text(20000), terms: text(20000),
      vatRegistered: { anyOf: [{ type: "boolean" }, { type: "null" }], description: "True applies the supported standard VAT treatment, false means not registered, null means unknown. Never infer registration." },
      vatId: text(20000), discountMode: choice("none", "percent", "fixed"), discount: clearableDecimal,
    }, []), minProperties: 1 },
  }, ["fields"]),
  {
    name: approvedLineTool.name,
    description: approvedLineTool.description,
    parameters: approvedLineTool.parameters,
  },
  tool("edit_quote_sections", "Create or rename up to 50 Quote Sections. Include an existing stable ID to rename it; omit the ID to create a section at the end. An empty title leaves an incomplete section and never deletes it. Write new titles in French. Do not add, edit, move, copy or delete Quote Lines with this tool. Do not move, copy or delete sections with this tool.", {
    sections: list(object({ id, title: text(4000) }, ["title"])),
  }, ["sections"]),
  tool("copy_quote_work", "Copy up to 50 Quote Lines or one Quote Section with its lines. For line copies, optionally choose a destination section; otherwise copies follow their source lines. For a section copy, supply its title. Set measurementPolicy to retain to keep measurements, or unknown to clear quantities and remove embedded measurements. Other values are retained.", {
    source: { anyOf: [
      object({ lineIds: { ...list(id), uniqueItems: true }, destinationSectionId: sectionIdOrNoSection }, ["lineIds"]),
      object({ sectionId: id, title: { ...text(4000), minLength: 1 } }),
    ] }, measurementPolicy: choice("retain", "unknown"),
  }, ["source", "measurementPolicy"]),
  tool("move_quote_work", "Move or reorder up to 50 Quote Lines or Quote Sections. For lines, supply a destination section ID; use an empty string for No section. Supply IDs in the desired order. Use beforeLineId or beforeSectionId to insert before an existing line or section; omit it to append. Do not edit content, copy or delete work with this tool.", {
    move: { anyOf: [
      object({ lineIds: { ...list(id), uniqueItems: true }, destinationSectionId: sectionIdOrNoSection, beforeLineId: id }, ["lineIds", "destinationSectionId"]),
      object({ sectionIds: { ...list(id), uniqueItems: true }, beforeSectionId: id }, ["sectionIds"]),
    ] },
  }, ["move"]),
  tool("delete_quote_lines", "Delete up to 50 explicitly identified Quote Lines. Supply their existing IDs. Do not delete Quote Sections or remove all work; direct those requests to the manual controls.", {
    lineIds: { ...list(id), uniqueItems: true },
  }, ["lineIds"]),
];
writeFileSync(new URL("./proposed-tools.json", import.meta.url), `${JSON.stringify(tools, null, 2)}\n`);
