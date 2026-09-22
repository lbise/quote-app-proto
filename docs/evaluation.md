# Local assistant evaluation

Issue [#29](https://github.com/lbise/quote-app-proto/issues/29). This is local review tooling, not a product-owner sign-off or a model benchmark.

## Current status

The library prioritizes joinery/cladding and includes landscaping and civil works. Its commercial examples come from the reviewed adaptations in [`examples/first-quotes/`](examples/first-quotes/). Synthetic arithmetic and recovery cases are labelled separately.

Inputs and expected outcomes still need human review. The product owner allowed retaining prices and technical specifications in local anonymized fixtures. That is **not provider-data approval**. Every scenario starts with provider use blocked.

Live execution currently refuses to run. The registered provider's usage/pricing information does not establish an enforceable monetary ceiling. The CLI requires explicit opt-in, provider-data approval and bounded-run options, but those flags cannot bypass this limitation. Do not describe offline passes as evidence of model interpretation quality. Live execution, product fixes discovered by it, final prompt/tool acceptance and product-owner sign-off remain unfinished parts of #29. #21 still owns production provider approval; #22 owns the external Artisan session. Multi-model comparisons are out of scope.

## Browse without making calls

```sh
npm run eval:review
```

Open `http://127.0.0.1:4319`. The report runs separately from the production app. It binds only to loopback, does not load application credentials, and cannot trigger provider calls. Use `-- --port 4320` for another port or `-- --root /path/to/local/artifacts` to review another artifact directory.

The report shows source notes, the starting Working Draft, scripted Artisan messages and manual actions, independent expectations, forbidden changes and required human checks. Runs add expected/actual comparisons, changed fields, assertions, conversation, tool attempts and diagnostics. Long technical descriptions remain readable instead of being replaced by exact-reply snapshots.

## Run controlled offline checks

The runner uses the actual Quote HTTP handler, assistant prompt, model loop, registered tools and PostgreSQL commit logic. Only the model transport is controlled. It never substitutes an always-successful tool executor.

Start a disposable PostgreSQL container:

```sh
npm run eval:db -- up
export EVAL_DATABASE_URL="$(bash scripts/eval-db.sh url)"
EVAL_DATABASE_URL="$EVAL_DATABASE_URL" npx vitest run eval/runner.test.ts eval/isolation.test.ts
```

Each scenario gets a fresh database cloned from the migrated evaluation template. The runner drops that database afterwards. It rejects normal application connection strings and never falls back to `DATABASE_URL` or `TEST_DATABASE_URL`. Do not point evaluation tools at an application database or load a real-data dump into the evaluation template.

Create an intentionally failing smoke artifact:

```sh
npm run eval:run -- --offline-smoke \
  --scenario joinery-full-reconstruction \
  --database-url "$EVAL_DATABASE_URL"
```

This uses a no-op faux model. The reconstruction **must fail** because the model did not add the requested work. It proves that a model's claim of success cannot replace commercial-state assertions; it does not evaluate a live model. Select another `*-full-reconstruction` scenario or add `--repetitions 2`. Each run gets a new artifact ID.

```sh
npm run eval:db -- down
```

Stopping the database does not remove reports. Routine `npm test` makes no provider calls. Database integration tests need the explicit evaluation URL above; without it, Vitest reports those tests as skipped.

For CLI options and the current live-execution refusal:

```sh
npm run eval:run -- --help
```

## Source handling

Never add original PDFs, archives, extracted text, identifying filenames, party details, bank/VAT identifiers or document references. Use non-identifying aliases. Invent unrelated administrative details with `.test` contact domains. Original archives and `.eval-artifacts/` are ignored by Git; evaluation files and originals are excluded from the production Docker build context.

The existing source reviews document uncertain units, source arithmetic differences and the invoice-to-Quote adaptation. In particular:

- Joinery has 30 positive-priced lines in seven sections. Prior-payment deductions and invoice balance framing are excluded.
- Landscaping has 14 priced lines. The source omitted units and its printed subtotal omitted a retained line. Adapted units must be supplied explicitly, not inferred from expected answers.
- Civil works has 17 priced lines. Its unpriced source position is excluded from the full reconstruction and evaluated separately as incomplete work.
- Fixture VAT of 8.1% and cent half-up rounding are deliberate adaptations, not evidence that historical source tax treatment is supported.

A local numeric-presence check against the supplied PDFs found all 30, 17 and 14 retained line amounts respectively. That check did not transmit PDFs or extraction and does not replace semantic source review. The six supplied documents also include an additional window-work document and two documents without extractable text. They have no reviewed scenario adaptations yet; adding them needs local inspection or OCR and the same anonymization review. This library does not claim to cover all six documents.

Removing names does not establish statistical anonymity. Technical descriptions, prices and terms may remain confidential. Provider suitability needs separate approval for the exact adapted inputs and chosen provider.

## Add or revise a scenario

1. Inspect the original locally. Start from a reviewed adaptation where available. Record only a source alias and adaptation notes, not a path to the original.
2. Add a versioned `Scenario` in `eval/scenarios.ts`. Record interface language, starting Working Draft, scripted Artisan messages, manual saves, clarification requirements and prohibited changes. Supply adapted units explicitly. Never let another model invent follow-up facts or consent.
3. Put model-visible facts only in the starting draft, permitted conversation or Artisan messages. The runner does not send provenance, expected Quotes, assertions or review notes to the provider. Current HTTP-based execution rejects seeded history; use explicit Artisan steps for multi-turn scenarios.
4. Work expected numbers independently using Python `Decimal` with `ROUND_HALF_UP`. `python3 eval/expectations.py` checks the reference totals and arithmetic examples without importing the application calculator. Record independent literals or source-verified line amounts in the scenario. The application calculator supplies **actual** amounts only.
5. Add assertions for changed commercial values and unchanged unrelated work, not just a total or a reply saying it succeeded. Quote projection ignores generated IDs but retains line and section order. Unknown numeric values are empty, not zero. Use `contains` for a required missing-information entry and explicit outcomes for expected discarded turns. An empty assertion list is not a passing case.
6. Increment the scenario version whenever inputs, adaptation, assertions or review status change. Review inputs and expectations locally. Record who approved them and why in the review note. Keep provider approval blocked until explicitly granted for that version and provider.
7. Run focused offline tests and inspect the browser report. A deterministic pass cannot prove faithful French wording, useful clarification or absence of invented commitments.

## Save human review

Choose a saved run, inspect its commercial state and conversation, then complete the Human review form. Wording, invented facts and clarification each start as pending. Save creates a new review record against the exact run ID and scenario hash; it does not rewrite an earlier review. Rerunning a scenario creates a different run and does not inherit approval. Automatic outcome, human review and scenario/provider approval stay separate.

Artifacts are JSON under `.eval-artifacts/runs/` and `.eval-artifacts/reviews/`. New directories use mode `0700` and files `0600`. They intentionally contain commercial content and model conversations for these evaluation cases, not application conversations. Do not upload reports or expose the server publicly. Credential-shaped metadata is redacted, but that is not a general-purpose anonymizer for arbitrary text. A reviewer should never paste credentials into scenario content or notes.
