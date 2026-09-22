# Local assistant evaluation

Issue [#29](https://github.com/lbise/quote-app-proto/issues/29). This is local review tooling, not a product-owner sign-off or a model benchmark. See [implementation review and verification](evaluation-review.md).

## Current status

The library has two suites: four fictional contract checks and 26 scenario cases. The scenario suite prioritizes joinery/cladding and includes landscaping and civil works. Its commercial examples come from the reviewed adaptations in [`examples/first-quotes/`](examples/first-quotes/). Synthetic arithmetic and recovery cases are labelled separately. Adding contract checks does not change the existing scenarios or their approval hashes.

Inputs and expected outcomes still need human review. The product owner allowed retaining prices and technical specifications in local anonymized fixtures. That is **not provider-data approval**. Every scenario starts with provider use blocked.

Live execution has a dedicated bounded Google boundary. It is not a product benchmark and an offline pass is not evidence of model interpretation quality. Do not claim live evidence until a saved run has been inspected. Product fixes discovered by evaluation, final prompt/tool acceptance and product-owner sign-off remain unfinished parts of #29. #21 still owns production provider approval; #22 owns the external Artisan session. Multi-model comparisons are out of scope.

## Browse without making calls

```sh
npm run eval:review
```

The command prints localhost and this machine's private IPv4 URLs on port 4319, including LAN and Tailscale addresses. Open one of the private URLs from another device on your trusted network. The report runs separately from the production app, does not load application credentials, and cannot trigger provider calls.

By default it binds to `0.0.0.0`, accepts only loopback or private-network peers, and allows only exact local interface addresses in the Host header. RFC 1918 networks and Tailscale's `100.64.0.0/10` range are supported. Review submissions still require the same origin. There is no login: anyone who can reach it from an allowed network can read commercial data and save reviews. Restrict port 4319 to trusted devices with your firewall; do not add a public reverse proxy or port forward.

Use `-- --host 127.0.0.1` for localhost-only access, `-- --host <local-private-ip>` for a single interface, `-- --port 4320` for another port, or `-- --root /path/to/local/artifacts` to review another artifact directory.

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

Stopping the database does not remove reports. Fault-injection scenarios are marked `controlled-only`. Their commercial work remains source-derived, but a controlled transport must supply failures; they are not benchmarks that require a live model to make mistakes. The runner's offline API accepts the faux provider only.

Routine `npm test` makes no provider calls. Database integration tests need the explicit evaluation URL above; without it, Vitest reports those tests as skipped. With evaluation integration enabled, Vitest limits concurrency to two workers so database cloning does not overwhelm a shared local PostgreSQL instance.

For CLI options:

```sh
npm run eval:run -- --help
```

## Run a bounded live evaluation

Live mode transmits the selected case inputs to the configured provider. It requires each of the following: `--live`, an explicit `--suite` or at least one `--scenario`, `--approve-provider-data-review`, `--database-url`, `--max-calls`, `--max-elapsed-ms`, and `--max-spend-usd`. It rejects `controlled-only` fault-injection scenarios before provider configuration or any provider call.

`--approve-provider-data-review` is runtime authorization for the exact selected adapted scenario hashes, provider and model in this one session. It does not alter the library's `pending`, `blocked`, or reviewed flags. It is not a human prose approval, a Publication of a Quote, or #21 production-provider approval.

The provider environment file needs `QUOTE_AI_PROVIDER=google`, `QUOTE_AI_MODEL=gemini-3.5-flash-lite`, and your `GEMINI_API_KEY`. For the long reconstruction, consider `QUOTE_AI_TIMEOUT_MS=45000`; the application turn deadline otherwise defaults to 20 seconds and remains separate from the session deadline.

Start the disposable database if it is not already running. Run the focused contract checks below before returning to a full reconstruction. The following full-scenario command is an example, not evidence that it was run here:

```sh
npm run eval:db -- up
npm run eval:run -- --live --scenario joinery-full-reconstruction --provider-env-file .env --approve-provider-data-review --max-calls 8 --max-elapsed-ms 120000 --max-spend-usd 5 --database-url "$(bash scripts/eval-db.sh url)"
```

One session is shared by every selected scenario and repetition. The CLI saves each completed run, stops all remaining loops after a stopped session, and exits nonzero for a failed run or a stopped session. Review the saved artifacts with `npm run eval:review`; if that review server is already running, use the URL it printed rather than starting another server.

Only registered `google` with the exact model `gemini-3.5-flash-lite` is supported. Other provider or model selections fail closed; there is no fallback. The boundary pins a verified price snapshot that expires on **2026-09-29**. Renew the documented rates and expiry before then or live execution must fail closed.

The snapshot conservatively uses the highest published text rates: 540 nanodollars per input token and 4,500 per output token. These are Priority rates, although this boundary submits ordinary Standard requests. Before every provider call, the session irrevocably reserves the full 1,048,576 input tokens plus 4,096 output tokens: **$0.58466304**. It does not release a reservation, including when actual usage is smaller. For example, eight calls reserve at most **$4.67730432**, so they fit within a `$5` cap. The full invocation is capped, not each scenario.

The boundary uses no retries, permits at most 4,096 output tokens including thinking tokens, and uses minimal thinking even though ordinary app settings say thinking is off. Missing, partial, malformed, errored, or aborted usage stops the session and retains its reservation. Artifacts record estimated usage separately from reserved upper bounds. This is a bound under the recorded document rates, not a promise about a provider invoice or an account-wide spending guarantee.

The line tool recommends about five lines per response for long requests, with smaller batches for long descriptions or citations. It must continue through the supplied work without omitting facts or duplicating accepted lines. This is model guidance, not a guarantee of live interpretation quality; the 50-line schema maximum and all execution budgets remain unchanged.

Saved live calls show the SDK stop reason and provider finish reason when available. A call marked `complete` has usable usage accounting, not necessarily a successful Quote edit. Google `MAX_TOKENS` maps to SDK `length`; the application reports `assistant_output_limit_exceeded` and discards the whole turn without requesting another model response. Developer details also show these terminal codes. Older artifacts lack this metadata and display `not recorded`; their missing reasons cannot be reconstructed from the report.

CLI limits are positive and bounded: `--max-calls` is at most 10,000, `--max-elapsed-ms` at most 3,600,000, and `--max-spend-usd` at most 1,000,000 with no more than nine decimal places. The live boundary validates them again.

For live mode only, `--provider-env-file PATH` parses only `QUOTE_AI_PROVIDER`, `QUOTE_AI_MODEL`, `GEMINI_API_KEY`, and `QUOTE_AI_TIMEOUT_MS` using `dotenv.parse`; it does not call global dotenv configuration or mutate `process.env`. Exported process-environment values win over that file. The option is rejected in offline mode and when `--live` is absent. Never load a real `.env` for an offline smoke run. This flag deliberately differs from Node's `--env-file`, which can preload all variables before the program starts.

## Focused live contract checks

Use these to check whether the configured model can construct valid calls from the production prompt and tool definitions before diagnosing a full Quote. They use the same Quote HTTP handler, registered tools, isolated PostgreSQL state and live-session limits. Their inputs are entirely fictional and do not copy the tool description's worked example.

| Case ID | What it checks |
| --- | --- |
| `contract-fixed-line` | Capture one fixed-price line with its pricing-mode evidence. |
| `contract-quantity-line` | Capture one line with quantity, unit and unit price. |
| `contract-section-assignment` | Create a section, then use its returned ID to place a line. |
| `contract-split-evidence` | Capture a line whose quantity and price are supplied in separate passages. |
| `contract-mixed-batches` | Capture eight lines in two sections, mixing fixed and quantity pricing, distant shared rates, composite descriptions and continuation beyond a five-line batch. |

Preview the selection without loading provider credentials or making calls:

```sh
npm run eval:run -- --suite contract
```

After reviewing the inputs and explicitly approving their transmission, run:

```sh
npm run eval:run -- --live --suite contract \
  --provider-env-file .env \
  --approve-provider-data-review \
  --max-calls 16 --max-elapsed-ms 120000 --max-spend-usd 10 \
  --database-url "$(bash scripts/eval-db.sh url)"
```

The 16-call limit is shared across all five checks, not granted to each one. At the recorded rates, 16 calls reserve at most USD 9.35460864, not an actual charge. Repetitions share that same invocation budget. No full scenario runs automatically after these checks.

If the four basics have already passed, select only the new combined check with `--scenario contract-mixed-batches`. A separately approved invocation can use `--max-calls 6 --max-elapsed-ms 120000 --max-spend-usd 4`; six calls reserve at most USD 3.50797824. The scripted clean replay takes four responses, but live-model call counts can differ.

Use `--suite contract --scenario contract-fixed-line` for one check. A scenario ID outside the selected suite is an error. `--suite scenario` previews the original 26 cases; select explicit IDs for live execution because selections containing `controlled-only` fault-injection cases are rejected.

Contract runs report two outcomes separately:

- **Contract:** normal committed completion with zero failed tool calls and passing contract assertions. A repaired rejection still fails this check.
- **Commercial:** expected line values, section assignment, independently worked calculations and preservation of unrelated fields. Correct amounts do not hide contract failures.

Both must pass for the automated run to pass. French wording, faithful interpretation and invented commitments still require human review. The first four checks cover individual operations. The fifth combines them under a longer input and multiple batches. It does not force a particular batch partition or prove reliable interpretation of a 30-line Quote. Forced failures, transport errors, rollback and concurrency stay in controlled offline tests. Passing small live checks does not establish full-scenario quality.

The four basic checks passed live in session `cdc11ef3-416b-4b5b-9a47-9db4136673b7`. The subsequent full reconstruction, run `7651d62f-1c54-4e8b-984e-e7738ee6bc54`, still failed because the model joined separate passages into purported exact excerpts. It repaired one batch, then repeated the mistake in the next batch and reached the third-failed-call rollback. The combined fixture targets this missing coverage. Rejected citations now get bounded split suggestions when each of two or three short fragments independently matches the same permitted source. This includes omitted passages between whole sentences and inserted ellipses. Suggestions do not authorize edits: the entire rejected call remains unapplied, and the model must resubmit complete arguments with valid citations. A clean offline replay does not prove that the live model will construct or repair the citations correctly.

Run `09bec8b6-3235-4603-a89e-ccd205388d48` exposed a separate encoding error in the combined fixture: the model copied literal `\n\n` from the JSON wrapper instead of decoded paragraph breaks. Offline replay isolated that difference in all three rejected line calls. Citation descriptions now recommend decoded, single-paragraph excerpts, with a multiline worked example. Escaped-whitespace repair suggestions are offered only when replacing those separators alone produces a source-contained excerpt, and the existing fragment/count bounds still apply. No argument is automatically decoded or accepted; literal backslashes actually present in a source remain valid.

Run the offline replays without provider calls:

```sh
EVAL_DATABASE_URL="$(bash scripts/eval-db.sh url)" npx vitest run eval/contract.test.ts
```

The report groups both suites and retains the separate outcomes. Older artifacts without suite metadata remain scenario runs; missing check outcomes are not retroactively inferred. New contract definitions live in `eval/contract-scenarios.ts`; their amounts are checked by the same independent Decimal script as the scenario suite.

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
2. Add a versioned `Scenario` in `eval/scenarios.ts`, or a fictional contract check in `eval/contract-scenarios.ts`. Contract checks tag protocol assertions with `category: "contract"`; untagged assertions check commercial state. Record interface language, starting Working Draft, scripted Artisan messages, manual saves, clarification requirements and prohibited changes. Supply adapted units explicitly. Never let another model invent follow-up facts or consent.
3. Put model-visible facts only in the starting draft, permitted conversation or Artisan messages. The runner does not send provenance, expected Quotes, assertions or review notes to the provider. Current HTTP-based execution rejects seeded history; use explicit Artisan steps for multi-turn scenarios.
4. Work expected numbers independently using Python `Decimal` with `ROUND_HALF_UP`. `python3 eval/expectations.py` checks the reference totals, arithmetic examples and every final expected calculation without importing the application calculator. `eval/expected-calculations.json` contains the independently established final line/section amounts, totals and missing-field expectations. After changing an authored expected Quote, use `python3 eval/expectations.py --write`, inspect the diff and independently review it before approval. The application calculator supplies **actual** amounts only.
5. Add assertions for changed commercial values and unchanged unrelated work, not just a total or a reply saying it succeeded. Quote projection ignores generated IDs but retains line and section order. Unknown numeric values are empty, not zero. Use `contains` for a required missing-information entry and explicit outcomes for expected discarded turns. Use `oneOf` with an explicit list for equivalent unit spellings, not different physical units. An empty assertion list is not a passing case.
6. Increment the scenario version whenever inputs, adaptation, assertions or review status change. Review inputs and expectations locally. Record who approved them and why in the review note. Keep provider approval blocked until explicitly granted for that version and provider.
7. Run focused offline tests and inspect the browser report. A deterministic pass cannot prove faithful French wording, useful clarification or absence of invented commitments.

## Save human review

Choose a saved run, inspect its commercial state and conversation, then complete the Human review form. Wording, invented facts and clarification each start as pending. Save creates a new review record against the exact run ID and scenario hash; it does not rewrite an earlier review. Rerunning a scenario creates a different run and does not inherit approval. Automatic outcome, human review and scenario/provider approval stay separate.

Artifacts are JSON under `.eval-artifacts/runs/` and `.eval-artifacts/reviews/`. Live-session approval manifests and append-only reservation ledgers are under `.eval-artifacts/live-sessions/`. Each reservation is flushed before submission; errors and interrupted commands do not release it. A new command creates a new budget, not a continuation of an old one. New directories use mode `0700` and files `0600`. They intentionally contain commercial content and model conversations for these evaluation cases, not application conversations. Do not upload reports or expose the server publicly. Credential-shaped metadata and recognizable credential strings in notes are redacted, but that is not a general-purpose anonymizer for arbitrary text. A reviewer should never paste credentials into scenario content or notes.
