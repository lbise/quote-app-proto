# Evaluation implementation review

Baseline: `5af26f8`. Issue #29 remains open for live execution and product-owner acceptance.

## Standards

No documented repository-standard violations remained. The first review identified credential handling in free-text review notes and three maintainability suggestions. Saved notes now use the same credential redaction as run artifacts. Assertion helpers have explicit names, reconstruction configuration uses an object, and the joinery helper checks the profession. The renderer retains `h` as its local HTML-escaping shorthand.

A follow-up concern about zero-quantity outcomes did not reproduce through the real execution path. A clarification without a tool call and a clarification after one rejected call both pass the scenario. Repeated failures ending the turn remain evaluation failures rather than silently becoming successful clarification.

## Spec

The review found three offline gaps: blank descriptions could pass reconstruction checks, focused expected Quote views lacked calculations, and tool results were not retained. These are fixed. Complete reconstructions now require no missing/error fields. All 26 final expected states have independent line/section amounts, totals and incompleteness. Debug traces retain tool return values and stale-turn attempts.

The final review then found a percentage-unit error in the independent Python generator. It applied `10` rather than `10 / 100`. The corrected generator agrees with the original hand-worked discount of CHF 357.38 and total of CHF 3,476.95. A regression test checks every scenario's independent final calculation against the application's public calculation boundary, and the Python generator checks this hand-worked example before writing data.

At this baseline, live execution controls, input/provider approval and final human acceptance were incomplete. The follow-up below completes the execution controls. Neither review authorizes provider transmission or claims that a live model passed the library.

## Verification

- Typecheck and production build passed.
- Full Vitest suite: 129 passing tests, including application and evaluation PostgreSQL integration tests. Separate disposable databases served application tests and the evaluation template.
- Existing application browser suite: 66 passing tests.
- `python3 eval/expectations.py` passed after the percentage fix.
- Local report checked with agent-browser: library browsing, expected/actual amounts, intentionally failed reconstruction, missing quantity, saving/reopening pending review notes, and retention across later runs.
- Accessibility checks reported zero WCAG A/AA violations on the inspected library and run pages. No horizontal overflow at 320, 375, 414, 768 or 1440 pixels.
- Controlled no-op joinery reconstruction artifacts remain local and intentionally fail. They are not live-model results or human approvals.

The first full-suite attempt used production mode and stopped at the application's fake-email safety guard. Rerunning in the intended test/development modes passed. No production database or credentials were needed. The disposable database container was removed after verification.

## Bounded live execution follow-up, 2026-09-22

Baseline for this change: `663dfdd`. Live runs now require explicit selection, launch-time data approval and shared call/time/USD limits. Only the reviewed Google Gemini 3.5 Flash Lite configuration is supported. Each attempted request reserves its worst-case token cost before submission. Usage does not release reservations. The price review expires on 2026-09-29. See [the pricing sources and assumptions](research/evaluation-google-budget.md).

### Standards review

Resolved the payload-hook finding by retaining the application's inspection callback while rejecting replacements, in-place mutation and abort-signal replacement. Corrected approval wording to cover the selected scenarios in the invocation, and included the full approved-hash set in each live artifact. The follow-up review found no remaining issue.

### Spec review

Added directory and ancestor fsync after creating the reservation ledger, so flushing file contents is not mistaken for persisting its directory entry. Rejected manual-only live selections to prevent a zero-call case from appearing to evaluate a model. The follow-up review found no remaining issue. Human acceptance and real-model interpretation evidence remain pending.

### Verification

- 154 Vitest tests passed, including all application and evaluation database tests. The real Google SDK ran against mocked HTTP responses; no provider request was sent.
- Covered shared limits across repetitions, rollback at a limit, deadline cancellation, unknown/partial usage, payload restrictions, exact approval scope, pricing expiry, cached/thinking usage and no hidden SDK retry.
- The CLI test exposed Node's early handling of `--env-file`. The replacement flag is `--provider-env-file`; only four provider variables are selected after approval. No global dotenv loading is used by this command.
- The combined database suite initially exceeded the default five-second test timeout under full file concurrency. Two workers remove that local PostgreSQL contention without increasing test timeouts. An initial application test database name also lacked its required `_test` suffix; verification used a correctly named, separate disposable database.
- Typecheck, production build and independent Decimal expectations passed.
- Browser check over the private-network URL confirmed the authored-reference notice, version-2 offline expected/actual report and pending human review. No detected WCAG A/AA violations or horizontal overflow at 375px.
- One new version-2 no-op smoke artifact was intentionally retained locally. It fails reconstruction as expected and is not live-model evidence.
