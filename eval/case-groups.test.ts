import { expect, it } from "vitest";
import { launchForm } from "./execution-report";
import { caseGroups, groupsFor } from "./case-groups";
import { scenarios } from "./scenarios";

it("groups focused behavior across trades without reclassifying realistic reconstructions", () => {
  const byId = (id: string) => scenarios.find(item => item.id === id)!;
  expect(groupsFor(byId("joinery-full-reconstruction"))).toEqual(["full-job"]);
  expect(groupsFor(byId("joinery-missing-measurement-clarification"))).toContain("clarification");
  expect(groupsFor(byId("civil-unpriced-position-clarification"))).toContain("clarification");
  expect(groupsFor(byId("joinery-panel-correction"))).toContain("correction");
  expect(groupsFor(byId("joinery-copy-unknown-measurement"))).toContain("copy-move");
  expect(groupsFor(byId("joinery-stale-turn-rollback"))).toContain("safety-recovery");
  expect(groupsFor(byId("contract-fixed-line"))).toContain("capture");
  expect(caseGroups.map(group => group.id)).toEqual(["full-job", "capture", "clarification", "correction", "copy-move", "safety-recovery"]);
  expect(scenarios.every(scenario => groupsFor(scenario).length > 0)).toBe(true);
});

it("offers a behavior filter and select-visible control without bypassing controlled-only restrictions", () => {
  const html = launchForm({ scenarios, launchRequestId: "test" });
  expect(html).toContain('id="behavior-filter"');
  expect(html).toContain('id="select-visible"');
  expect(html).toContain('data-groups="clarification"');
  expect(html).toContain('value="joinery-full-reconstruction"');
  expect(html).toMatch(/value="joinery-third-failure-discard"[^>]*disabled/);
});
