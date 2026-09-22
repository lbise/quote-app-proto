# Assistant contract signoff

Status: this is the approved replacement contract for the Quote assistant. It documents intended behavior and implementation boundaries. It does not claim that an executor, registry, provider call, or test run is live.

Implement [#26](https://github.com/lbise/quote-app-proto/issues/26), then [#27](https://github.com/lbise/quote-app-proto/issues/27), then [#28](https://github.com/lbise/quote-app-proto/issues/28). Register only tools with a working executor.

## Contract

The assistant receives the complete current Working Draft, its authoritative calculation, recent bounded conversation, and the current Artisan message before the first model call. It does not need `read_work`. The draft may include copied Customer and business details. It excludes unrelated Quotes, reusable directories, older Published Revisions, credentials, ownership IDs, and account configuration.

The assistant may faithfully translate, reword, organize, and enter supplied work. New line descriptions and section titles are French in either interface language. It must not invent quantities, measurements, materials, prices, or commitments. Unknown values stay empty, not zero. If the target or commercial meaning is ambiguous, it asks a focused question rather than changing the draft.

Tools accept commercial and structural arguments directly. They do not require source excerpts or provenance arguments. The application validates argument shape, field types, decimal precision, ranges, pricing modes, stable targets, complete batches, whole-Quote validity, and calculated amounts. It calculates line amounts, subtotals, Discount, VAT, and totals. It does not establish that a model interpreted the Artisan correctly, chose the right target, translated faithfully, or derived a quantity or adjusted price correctly. Human review remains required before Publication.

The assistant cannot create a Quote or later Working Draft, publish, send, accept, or perform Undo. Customer and business edits change only the current Quote snapshot, never reusable records or defaults. Publication and Undo remain manual actions.

## Registered replacement tools

The reviewed replacement definitions are in [proposed-tools.json](proposed-tools.json). They are proposals until their executor is registered.

- `edit_quote_details` changes only named Quote-level fields. Omitted fields are unchanged. Empty strings deliberately clear text or decimal fields where allowed.
- `edit_quote_lines` creates or edits one through fifty complete lines. An existing ID edits that line; an omitted ID creates one. A new line may name a section. Quantity lines use quantity, unit, and unit price. Fixed lines use amount. Unknown, cleared, and mode-incompatible values are empty strings.
- `edit_quote_sections` creates sections or renames existing sections. It does not move, copy, or delete work.
- `copy_quote_work` copies explicit lines or one section with fresh IDs. `unknown` measurement policy clears affected quantities and removable measurements without guessing.
- `move_quote_work` moves or reorders explicit lines or sections without changing commercial content.
- `delete_quote_lines` deletes one through fifty explicit line IDs only. It cannot delete sections or all work.

No tool accepts a business ID, Quote ID, version, credential, endpoint, or publication permission. The request boundary owns those values.

## Turn behavior

Each tool call is atomic. Successful calls stage one candidate draft. The first two rejected calls leave prior successful changes available for a normal one-turn commit. The third rejected call discards all staged work and stops the turn. Authorization, stale-draft, provider, deadline, and execution-budget failures also discard the turn.

After normal completion, the application revalidates the complete candidate, recalculates it, checks the authenticated ownership and draft version, and commits one turn with one manual Undo target. A discarded turn never shows a model success reply. Request identity prevents duplicate accepted changes.

The starting limits are: 1,000 lines, 1,000 sections, and 220,000 serialized UTF-8 bytes for the complete draft; 24 whole recent messages within 24,000 characters; one current message within 8,000 characters; 50 operations per batch; 24 tool-call attempts; 12 model responses; three failed calls; and a 20-second default deadline configurable to 45 seconds. The complete draft is never truncated. An oversize draft is rejected for manual work.

## Data sharing and review

The provider may receive the current message, selected recent conversation, complete Working Draft, and calculation. This can include copied Customer and business details, VAT information, reference and dates, site details, terms, discounts, every line and section, and calculated amounts. See [messages.md](messages.md) and [Quote AI](../quote-ai.md).

Do not use sensitive, confidential, or real Customer data until the provider, plan, region, retention, and processing terms have been reviewed for the intended use. That review is separate from this contract. Even after a valid tool call, the Artisan must review quantities, prices, technical content, wording, and interpretation before Publication.

## Tests and evaluation

Use authenticated Quote HTTP operations with real PostgreSQL, a controllable model transport, and the real executor. Check whole-Quote validation and calculation, commit and persistence, partial success, third-failure rollback, Undo, stale edits, retries, ownership isolation, and English/French workflows. Scripted browser responses prove UI behavior only.

The evaluation suite has four small fictional contract cases and one combined case. They cover fixed pricing, quantity pricing, section assignment, facts supplied in separate paragraphs, and two-section mixed batches. They assert committed state and calculations; they do not prove faithful interpretation. See [examples.md](examples.md) and [evaluation.md](../evaluation.md).

## Historical artifacts

`current-inventory.md` records the pre-replacement baseline for migration and review. `foundation-tools.json` is retained only for the staged legacy transition. Neither is the replacement model-facing contract. Older run reports and schema artifacts may retain their original labels so they can be interpreted accurately, but they do not describe the replacement tool arguments.
