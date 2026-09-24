---
version: 1
slug: "eval-report-ts"
primary_target: "eval/report.ts"
related_targets: ["eval/execution-report.ts","eval/report.css","eval/execution-client.js"]
---

# Evaluation workspace

Mode: Operate. Scope: the standalone local evaluator only. The developer selects existing scenarios and investigates failed Scenario Runs. Preserve launch authorization, budgets, polling, Stop, reuse, human reviews and evidence. No custom-input authoring or cross-session comparison.

## Direction contract

THESIS: A debugger workspace puts failed checks next to their evidence instead of leading with a long scenario reference document.

OWN-WORLD: Neutral divided work panes, system UI text, compact labelled controls and a blue action accent. Light and dark themes use the same hierarchy and semantic states. Theme follows the system until explicitly chosen and persists locally.

STORY: Select scenarios, configure a model, launch explicitly, then open a Scenario Run to understand its failures. Expand full evidence when needed.

FIRST VIEWPORT: A compact top navigation holds New evaluation, Sessions and Scenario library plus the theme toggle. Launch uses a searchable selection pane and a configuration pane. History emphasizes model and outcome. Run results start with failed assertions and expected/actual evidence linked to execution steps. No permanent library sidebar.

FORM: IDE debugger, grounded candidate 4, seed 883c1f18. Other grounded candidates were test runner, request client, experiment notebook, CI log, spreadsheet and database query inspector. User approved the debugger structure and added light/dark switching. Signature interaction: jump from a failed check to its execution step, opening the enclosing evidence. Motion is limited to control feedback; no entrance animation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification

Inspected desktop and mobile layouts in both themes. An independent finish review requested accessible mobile comparison headers and truthful terminal-session guidance. Its follow-up verdict was `ship`, with both requested fixes resolved. The named reviewer was unavailable; an independent general agent used the fallback review contract.

238 evaluator tests and 13 evaluator browser tests passed. Typecheck and production build passed. The mechanical design scan found no issues. Axe found no violations on inspected pages; offscreen scenario-list contrast checks remained incomplete. Tests and preview used mocked provider traffic, with no paid model calls. Screenshots are local and ignored under `.impeccable/review/`. No raster assets ship with this UI.
