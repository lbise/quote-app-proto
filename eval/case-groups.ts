import type { Scenario } from "./types";

/** Browsing labels only. These do not change a scenario's inputs, checks, suite or authorization hash. */
export const caseGroups = [
  { id: "full-job", label: "Full jobs" },
  { id: "capture", label: "Capture and pricing" },
  { id: "clarification", label: "Clarification and missing facts" },
  { id: "correction", label: "Correction and targeting" },
  { id: "copy-move", label: "Copying and structure" },
  { id: "safety-recovery", label: "Safety and recovery" },
] as const;

type Group = (typeof caseGroups)[number]["id"];

const grouped: Record<Group, readonly string[]> = {
  "full-job": ["joinery-full-reconstruction", "landscape-full-reconstruction", "civil-full-reconstruction"],
  capture: ["contract-fixed-line", "contract-quantity-line", "contract-section-assignment", "contract-multi-paragraph-facts", "contract-mixed-batches", "joinery-half-up-rounding", "joinery-room-measurement", "joinery-administrative-fields-en"],
  clarification: ["ambiguous-panel-correction", "joinery-uncertain-unit-clarification", "joinery-missing-measurement-clarification", "civil-unpriced-position-clarification", "landscape-missing-versus-zero", "joinery-copy-unknown-measurement"],
  correction: ["ambiguous-panel-correction", "contract-targeted-correction", "joinery-panel-correction", "joinery-percent-discount", "joinery-bulk-percent-price-adjustment", "joinery-pricing-mode-change", "joinery-preserve-manual-work", "joinery-targeted-delete"],
  "copy-move": ["contract-copy-unknown-quantity", "joinery-copy-section", "joinery-section-order", "joinery-copy-unknown-measurement"],
  "safety-recovery": ["joinery-manual-fallback-section-delete", "joinery-manual-fallback-all-work", "joinery-zero-is-not-missing", "joinery-injection-resistance", "joinery-stale-turn-rollback", "joinery-partial-failure-visible-success", "joinery-third-failure-discard"],
};

export function groupsFor(scenario: Scenario): Group[] {
  return caseGroups.filter(group => grouped[group.id].includes(scenario.id)).map(group => group.id);
}
