import { describe, expect, it, vi } from "vitest";

import { emptyQuote, type QuoteData, type QuoteLine } from "./quote";
import {
  addQuoteSection,
  duplicateQuoteSection,
  moveQuoteSection,
  removeQuoteSection,
  renameQuoteSection,
} from "./quote-section-operations";

function line(id: string, sectionId: string, amount: string): QuoteLine {
  return { id, sectionId, description: `Work ${id}`, mode: "fixed", quantity: "", unit: "", unitPrice: "", amount };
}

function quote(): QuoteData {
  return emptyQuote("Q-1", {
    title: "Original draft",
    sections: [
      { id: "a", title: "Room A" },
      { id: "empty", title: "No work yet" },
      { id: "b", title: "Room B" },
    ],
    lines: [
      line("flat-1", "", "1.00"),
      line("flat-2", "", "2.00"),
      line("a-1", "a", "10.00"),
      line("a-2", "a", "20.00"),
      line("b-1", "b", "30.00"),
    ],
  });
}

function ids(quote: QuoteData) {
  return quote.lines.map((line) => line.id);
}

function sectionIds(quote: QuoteData) {
  return quote.sections.map((section) => section.id);
}

describe("Quote Section operations", () => {
  it("adds after a specified section, including an empty one, or at the end", () => {
    const original = quote();
    const before = structuredClone(original);
    const inserted = addQuoteSection(original, "a", "new", "New section");
    expect(sectionIds(inserted)).toEqual(["a", "new", "empty", "b"]);
    expect(inserted.sections[1]).toEqual({ id: "new", title: "New section" });
    expect(ids(inserted)).toEqual(ids(original));
    expect(sectionIds(addQuoteSection(inserted, null, "last", "Last"))).toEqual(["a", "new", "empty", "b", "last"]);
    expect(sectionIds(addQuoteSection(original, "empty", "after-empty", "After empty"))).toEqual(["a", "empty", "after-empty", "b"]);
    expect(addQuoteSection(original, "missing", "new", "New section")).toBe(original);
    expect(sectionIds(addQuoteSection(emptyQuote("Q-3"), null, "first", "First"))).toEqual(["first"]);
    expect(original).toEqual(before);
  });

  it("renames only the requested section, without changing line values or an earlier snapshot", () => {
    const original = quote();
    const snapshot = structuredClone(original);
    const renamed = renameQuoteSection(original, "a", "Kitchen");
    expect(renamed.sections).toEqual([{ id: "a", title: "Kitchen" }, ...original.sections.slice(1)]);
    expect(renamed.lines).toEqual(original.lines);
    expect(renamed.title).toBe("Original draft");
    expect(original).toEqual(snapshot);
    expect(renameQuoteSection(original, "missing", "Ignored")).toBe(original);
  });

  it("moves a section up and down with its lines, leaving ungrouped and in-section order intact", () => {
    const original = quote();
    const snapshot = structuredClone(original);
    const up = moveQuoteSection(original, "b", -1);
    expect(sectionIds(up)).toEqual(["a", "b", "empty"]);
    expect(ids(up)).toEqual(["flat-1", "flat-2", "a-1", "a-2", "b-1"]);
    const again = moveQuoteSection(up, "b", -1);
    expect(sectionIds(again)).toEqual(["b", "a", "empty"]);
    expect(ids(again)).toEqual(["flat-1", "flat-2", "b-1", "a-1", "a-2"]);
    expect(moveQuoteSection(again, "b", 1)).toEqual(up);
    expect(moveQuoteSection(up, "b", 1)).toEqual(original);
    expect(original).toEqual(snapshot);
    expect(moveQuoteSection(original, "a", -1)).toBe(original);
    expect(moveQuoteSection(original, "b", 1)).toBe(original);
    expect(moveQuoteSection(original, "missing", 1)).toBe(original);
    expect(moveQuoteSection(original, "a", 0)).toBe(original);
  });

  it("duplicates a section directly after its source with fresh line IDs and unchanged prices", () => {
    const original = quote();
    const snapshot = structuredClone(original);
    const newLineId = vi.fn().mockReturnValueOnce("copy-1").mockReturnValueOnce("copy-2");
    const copy = duplicateQuoteSection(original, "a", "a-copy", newLineId);
    expect(sectionIds(copy)).toEqual(["a", "a-copy", "empty", "b"]);
    expect(copy.sections[1]).toEqual({ id: "a-copy", title: "Room A" });
    expect(ids(copy)).toEqual(["flat-1", "flat-2", "a-1", "a-2", "copy-1", "copy-2", "b-1"]);
    expect(copy.lines.slice(4, 6)).toEqual(original.lines.slice(2, 4).map((source, index) => ({
      ...source, id: `copy-${index + 1}`, sectionId: "a-copy",
    })));
    expect(newLineId).toHaveBeenCalledTimes(2);
    expect(original).toEqual(snapshot);
    expect(copy.lines[4]).not.toBe(original.lines[2]);
  });

  it("duplicates empty sections without requesting a line ID", () => {
    const newLineId = vi.fn();
    const copy = duplicateQuoteSection(quote(), "empty", "empty-copy", newLineId);
    expect(sectionIds(copy)).toEqual(["a", "empty", "empty-copy", "b"]);
    expect(ids(copy)).toEqual(ids(quote()));
    expect(newLineId).not.toHaveBeenCalled();
    expect(duplicateQuoteSection(quote(), "missing", "x", newLineId)).toEqual(quote());
  });

  it("removes a section without deleting its lines or changing their prices", () => {
    const original = quote();
    const snapshot = structuredClone(original);
    const removed = removeQuoteSection(original, "a", false);
    expect(sectionIds(removed)).toEqual(["empty", "b"]);
    expect(ids(removed)).toEqual(["flat-1", "flat-2", "a-1", "a-2", "b-1"]);
    expect(removed.lines.slice(2, 4)).toEqual(original.lines.slice(2, 4).map((source) => ({ ...source, sectionId: "" })));
    expect(removed.lines.map((item) => item.amount)).toEqual(original.lines.map((item) => item.amount));
    expect(original).toEqual(snapshot);
    expect(sectionIds(removeQuoteSection(original, "empty", false))).toEqual(["a", "b"]);
  });

  it("stably groups interleaved input when ungrouping and reordering sections", () => {
    const original = emptyQuote("Q-2", {
      sections: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
      lines: [
        line("a-1", "a", "1.00"), line("flat-1", "", "2.00"),
        line("b-1", "b", "3.00"), line("a-2", "a", "4.00"),
        line("flat-2", "", "5.00"), line("b-2", "b", "6.00"),
      ],
    });
    expect(ids(moveQuoteSection(original, "b", -1))).toEqual(["flat-1", "flat-2", "b-1", "b-2", "a-1", "a-2"]);
    expect(ids(removeQuoteSection(original, "a", false))).toEqual(["flat-1", "flat-2", "a-1", "a-2", "b-1", "b-2"]);
    expect(ids(original)).toEqual(["a-1", "flat-1", "b-1", "a-2", "flat-2", "b-2"]);
  });

  it("explicitly deletes a section AND its lines, without touching the other groups", () => {
    const original = quote();
    const snapshot = structuredClone(original);
    const deleted = removeQuoteSection(original, "a", true);
    expect(sectionIds(deleted)).toEqual(["empty", "b"]);
    expect(ids(deleted)).toEqual(["flat-1", "flat-2", "b-1"]);
    expect(deleted.lines.map((item) => item.amount)).toEqual(["1.00", "2.00", "30.00"]);
    expect(original).toEqual(snapshot);
    expect(removeQuoteSection(original, "missing", true)).toBe(original);
  });

  it("keeps a usable sequence of draft snapshots without mutating prior states", () => {
    const start = quote();
    const added = addQuoteSection(start, "a", "c", "Room C");
    const freshIds = ["fresh-1", "fresh-2"];
    const copied = duplicateQuoteSection(added, "a", "a-copy", () => freshIds.shift()!);
    const moved = moveQuoteSection(copied, "b", -2);
    const ungrouped = removeQuoteSection(moved, "a", false);
    expect(sectionIds(start)).toEqual(["a", "empty", "b"]);
    expect(sectionIds(added)).toEqual(["a", "c", "empty", "b"]);
    expect(sectionIds(copied)).toEqual(["a", "a-copy", "c", "empty", "b"]);
    expect(sectionIds(moved)).toEqual(["a", "a-copy", "b", "c", "empty"]);
    expect(ids(moved)).toEqual(["flat-1", "flat-2", "a-1", "a-2", "fresh-1", "fresh-2", "b-1"]);
    expect(ids(ungrouped)).toEqual(["flat-1", "flat-2", "a-1", "a-2", "fresh-1", "fresh-2", "b-1"]);
    expect(copied.lines[2].sectionId).toBe("a");
    expect(ungrouped.lines[2].sectionId).toBe("");
    expect(start.lines[2].sectionId).toBe("a");
  });
});
