# Evaluation implementation review

Baseline: `5af26f8`. Issue #29 remains open for live execution and product-owner acceptance.

## Standards

No documented repository-standard violations remained. The first review identified credential handling in free-text review notes and three maintainability suggestions. Saved notes now use the same credential redaction as run artifacts. Assertion helpers have explicit names, reconstruction configuration uses an object, and the joinery helper checks the profession. The renderer retains `h` as its local HTML-escaping shorthand.

A follow-up concern about zero-quantity outcomes did not reproduce through the real execution path. A clarification without a tool call and a clarification after one rejected call both pass the scenario. Repeated failures ending the turn remain evaluation failures rather than silently becoming successful clarification.

## Spec

The review found three offline gaps: blank descriptions could pass reconstruction checks, focused expected Quote views lacked calculations, and tool results were not retained. These are fixed. Complete reconstructions now require no missing/error fields. All 26 final expected states have independent line/section amounts, totals and incompleteness. Debug traces retain tool return values and stale-turn attempts.

The final review then found a percentage-unit error in the independent Python generator. It applied `10` rather than `10 / 100`. The corrected generator agrees with the original hand-worked discount of CHF 357.38 and total of CHF 3,476.95. A regression test checks every scenario's independent final calculation against the application's public calculation boundary, and the Python generator checks this hand-worked example before writing data.

Live provider execution, enforceable spending controls, input/provider approval and final human acceptance remain incomplete. Nothing in this review authorizes provider transmission or claims that a live model passed the library.

## Verification

- Typecheck and production build passed.
- Full Vitest suite: 129 passing tests, including application and evaluation PostgreSQL integration tests. Separate disposable databases served application tests and the evaluation template.
- Existing application browser suite: 66 passing tests.
- `python3 eval/expectations.py` passed after the percentage fix.
- Local report checked with agent-browser: library browsing, expected/actual amounts, intentionally failed reconstruction, missing quantity, saving/reopening pending review notes, and retention across later runs.
- Accessibility checks reported zero WCAG A/AA violations on the inspected library and run pages. No horizontal overflow at 320, 375, 414, 768 or 1440 pixels.
- Controlled no-op joinery reconstruction artifacts remain local and intentionally fail. They are not live-model results or human approvals.

The first full-suite attempt used production mode and stopped at the application's fake-email safety guard. Rerunning in the intended test/development modes passed. No production database or credentials were needed. The disposable database container was removed after verification.
