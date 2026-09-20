# Assistant contract approval request

Status: **core system prompt and line/section editing definitions approved; copying accepted for evaluation; remaining contract proposed; not implemented**. This is the approval checkpoint for [#26](https://github.com/lbise/quote-app-proto/issues/26), including the future capabilities in [#27](https://github.com/lbise/quote-app-proto/issues/27) and [#28](https://github.com/lbise/quote-app-proto/issues/28). Runtime code is unchanged. Approval is recorded below, with its limited scope.

The product owner must approve the actual artifacts below before implementation. Approval of the earlier capability list is not approval of these texts. Any material change to prompts, schemas, authority, recovery, disclosure or confirmation rules needs renewed approval. This packet does not approve sending real Customer data to a provider.

## Review order

1. [Current inventory](current-inventory.md), the instructions and behavior being replaced.
2. [Complete approved core system prompt](proposed-system-prompt.txt), with the language substitution recorded below.
3. [Foundation tool definitions](foundation-tools.json), the nine implemented mutation tools proposed for #26, without `read_work`.
4. [Current future tool definitions](proposed-tools.json), the six-tool proposal. The [generator](build-proposed-tools.mjs) reads the approved line definition directly from [edit-quote-lines.ts](edit-quote-lines.ts). The `edit_quote_sections` entry is also approved, and `copy_quote_work` is accepted for evaluation. The remaining entries are still proposed. These files are review artifacts, not registered application tools.
5. [Behavior and wire contract](#behavior-and-wire-contract), below, including outputs, errors, limits and confirmation.
6. [Examples](examples.md), including initial capture, corrections, copies, bulk changes, ambiguity, recovery and destructive confirmation.
7. [Proposed disclosures and deterministic messages](messages.md).

## Approval record

### Core system prompt approved

Recorded on 2026-09-18. The product owner approved the revised core prompt in this conversation with: "yes record the whole system prompt in the doc and let's continue". This followed review of the complete shortened prompt and the two replacements covering application-provided reference facts and Customer/business details. The full approved text is in [proposed-system-prompt.txt](proposed-system-prompt.txt); its original filename is retained for existing links. This is a human conversational approval record, not approval inferred from generated code. No GitHub approval-comment URL is recorded.

The file contains the English-interface variant verbatim. For a French interface, substitute exactly `Reply in French.` for `Reply in English.`. The application chooses that sentence from the trusted interface setting, never from the language of Artisan input. New work descriptions and section titles remain French in both variants.

The approved text permits application-supplied reference facts. It does not add Customer-name lookup, material-cost lookup, a database-access tool or permission to use real Customer data. Existing evidence validation remains required; any future reference-data source needs an explicit supported validation path. Customer selection and automatic matching are separate from this prompt approval.

Removed explanations about current-state tracking, tool availability, copying, confirmation, recovery and commit status must not return as hidden system-prompt suffixes. Tool-specific instructions belong in reviewed tool definitions, correction instructions in rejected-call results and save status in application UI. Server-side safeguards remain unchanged.

### Design direction agreed

Recorded on 2026-09-18. After discussing the design, the product owner said, "ok it sounds good then I think". This records agreement with the design direction only. It does not approve every schema, tool, result format or unreviewed artifact. The agreed direction is:

- One evidence citation can cover several fields without duplicating its excerpt.
- No model-supplied correctionOf argument. The application tracks unresolved failures and correction attempts internally.
- Minimal successful acknowledgements, with generated IDs and application-derived changes returned when needed. Errors explain the failure and request a complete corrected call; detailed diagnostics stay internal.
- A fresh agent receives the complete current draft for every Artisan message. Small tool results support the bounded loop within that turn.

The exact correction matcher and remaining tool definitions still need review.

### Historical naming clarification

The earlier exchange about `edit_lines` replacing `edit_line` was misinterpreted by the agent. The product owner clarified: "what I ment is that edit_lines replaces edit_quote is that correct?" This historical note records the confusing old names. It is not approval inferred from that exchange.

### Tool names and model-facing line definition approved

Recorded in this conversation. The product owner explicitly accepted `edit_quote_details` and `edit_quote_lines`: "yep that's good names my dude there you go".

The product owner then approved the complete TypeBox definition for `edit_quote_lines`: "ok I think that's good for this tool go next". The canonical exact definition is [edit-quote-lines.ts](edit-quote-lines.ts).

That approval covers only the model-facing line definition. `edit_quote_lines` takes `lines`, an array of 1 through 50 full editable-line objects. An omitted `id` creates a line. An existing `id` edits that line. An unknown ID rejects the call. `sectionId` is optional only for a new line. An omitted or empty `sectionId` puts a new line in No section. Each line has a description of at most 20,000 characters, `mode` of `quantity` or `fixed`, and required string `quantity`, `unit`, `unitPrice` and `amount` fields. Unknown, deliberately cleared and mode-incompatible values are empty strings. It has no `op`, `update`, `adjust` or `quantityCalculation` argument.

Its optional grouped `evidence` array has entries shaped as `{ "fields": ["/lines/0/unitPrice"], "source": "current", "text": "exact excerpt" }`. `fields` uses JSON Pointers. `source` is `current`, `history_N`, `quote.FIELD`, `line:ID.FIELD` or `section:ID.FIELD`. The application injects sequential execution and enforces atomicity, ranges and evidence.

This does not approve a runtime executor, registration, an arbitrary stage plan, test seams, `edit_quote_details` fields, or any structural tool. It also excludes calculated-quantity and percentage-adjustment inputs. The arithmetic guarantees under #26 and #27 remain unresolved and have not been waived or silently removed. No implementation gate has passed for the packet as a whole.

### Model-facing section definition approved

The product owner approved `edit_quote_sections` in this conversation: "ok this one looks fine". The reviewed description and schema are the `edit_quote_sections` entry in [proposed-tools.json](proposed-tools.json). It creates or renames 1 through 50 sections with `{ id?, title }` entries and the shared optional grouped evidence. Titles have at most 4,000 characters. Existing sections keep their lines and position; new sections append and return generated IDs. Unknown or repeated IDs reject the whole call. An empty title leaves an incomplete section rather than deleting it. It does not move, copy or delete sections or change their lines. This approval does not cover the remaining structural tools.

### Model-facing copy definition accepted for evaluation

The product owner accepted `copy_quote_work` in this conversation: "ok I guess that's fine, to be seen if this tool is in fact useful." This accepts the reviewed description, source forms, measurement policy and bounded copying behavior for now, with an explicit usefulness question for later evaluation. Do not claim that the dedicated copy tool is proven useful. Evaluation should check whether it preserves copied content and reduces reconstruction errors or effort; any subsequent material contract change needs review.

The canonical proposal is the `copy_quote_work` entry in [proposed-tools.json](proposed-tools.json). A call copies either explicit line IDs, optionally to a destination section, or one complete section with a supplied title. It creates at most 50 lines and one section, returns new-ID mappings, preserves originals, and uses `retain` or `unknown` measurement policy as reviewed. This acceptance does not approve the remaining tools or authorize runtime changes before the contract checkpoint is complete.

### Still awaiting approval

The remaining tool definitions, including legacy foundation schemas and results, context/result contracts, recovery, limits, disclosures, confirmation and test seams remain proposed. No runtime redesign is authorized by core-prompt approval alone. Later approvals must identify the exact artifacts and any exclusions, with a conversation or issue-comment reference. The remaining review covers:

- Full-draft data sharing, including Quote-local Customer/business details and terms.
- Foundation schemas, registration and the staged plan below.
- Remaining end-state tools beyond `edit_quote_lines`, `edit_quote_sections` and the provisionally accepted `copy_quote_work`, including `edit_quote_details` fields, percentage adjustments and deletion confirmation.
- Three turn-wide correction attempts, whole-turn discard and diagnostics.
- Proposed size/execution limits and unsupported-request behavior.
- The test seams listed below. No new tests at these seams are written before this confirmation.

## Staged registration

The system message is exactly the approved core prompt with the explicit interface-language substitution described above. Do not append stage-specific paragraphs. The registration plan below remains a proposal; available tool definitions carry their own authority and restrictions. The application supplies dynamic data in the JSON wrapper described below, never by interpolating Quote prose into system text.

### #26 foundation

Register exactly the nine entries in `foundation-tools.json`. They retain their existing field limits, supported operations and legacy evidence shape, and replace obsolete `read_work` references. They do not take `correctionOf`. The proposed supply_missing_line_fields.fields schema also explicitly rejects empty objects and unknown properties, matching its executor's existing restrictions. The current Type.Partial serialization drops the source object's additionalProperties option; the proposal closes that schema gap. Remove `read_work` completely. Full context, structured results, correction handling, call rollback, debug changes, faithful description/unit rewriting and removal of automatic Publication-review opening are #26 work. The old special-case missing-field tool remains temporarily; consolidation belongs to #27. No new bulk, commercial-field, pricing-mode or deletion capability is implied by context visibility.

The existing description/unit source-containment rule must stop requiring verbatim text. Keep numeric evidence checks. Faithful translation remains a model obligation and human review task, not a claim that the validator proves semantic equivalence. Customer snapshot values still require supplied source text; changing address wording or clearing those fields is #27 work.

### #27 commercial edits

The #27 registration plan remains unapproved. Its proposed registry would register `edit_quote_details` and the approved model-facing `edit_quote_lines` definition, plus the five named structural tools from `foundation-tools.json`. It would retire `set_customer_info`, `add_quote_line`, `supply_missing_line_fields` and `update_quote_line`. Do not register future structural definitions merely because they appear in this packet. The unresolved arithmetic contract and stage plan still need review before implementation.

### #28 structural edits

Register exactly the six entries in `proposed-tools.json`, retiring the legacy structural names. No standalone confirmation tool exists. A future tool definition must not be registered merely because it appears in this packet.

## Behavior and wire contract

### Authority and input context

The authenticated request boundary derives the Artisan Business, Quote, current Working Draft and version from the session and database. No tool takes a business ID, Quote ID, version, credential, endpoint or publication permission. A Working Draft must already exist. Application-generated stable IDs identify lines and sections only within that draft.

Before the first provider call of every new Artisan message/turn, start a fresh agent and serialize this complete object as the one initial user message. The notation in angle brackets identifies typed data slots, not literal strings or extra instructions:

```json
{
  "contractVersion": "draft-tools-v1",
  "locale": "<en or fr>",
  "currentWorkingDraft": "<complete QuoteData object>",
  "referenceLocked": "<boolean, true after first Publication>",
  "capturedLineIds": ["<existing captured line IDs, foundation only>"],
  "calculation": "<authoritative calculation object without its duplicate quote property>",
  "history": [{ "id": "history_1", "role": "artisan", "text": "<whole message>" }],
  "historyOmitted": "<boolean>",
  "omittedHistoryCount": "<non-negative integer>",
  "currentMessage": { "id": "current", "text": "<current Artisan message>" }
}
```

`currentWorkingDraft` contains exactly the commercial fields in `QuoteData`: reference, title, customerName, customerAddress, customerContact, businessName, businessAddress, businessContact, vatId, issueDate, validUntil, siteAddress, terms, vatRegistered, discountMode, discount, sections and lines. Include every line field, including empty strings, stable IDs, section IDs and array order. `calculation` contains errors, missing, line IDs/numbers/amounts, section subtotals/incomplete flags, subtotal, discount, net, vat, total and complete. Amounts are integer CHF cents or null, as returned by the domain calculator. Do not expose a second copy of the Quote in the calculation object. Currency is CHF and the supported registered VAT rate is 8.1%; these are application rules, not writable fields.

History carries recent intent only. It retains whole most-recent messages, oldest-to-newest within the retained window, using the selected interface-language text. History IDs identify retained messages for this request only. Select at most 24 messages and 24,000 UTF-16 code units independently of draft size; stop at the first older message that does not fit. Do not skip a large recent message to include smaller older messages. The current message appears once and is limited to 8,000 code units. Roles are artisan, assistant or note. Only artisan messages can supply new commercial evidence. Omission never removes commercial state from currentWorkingDraft.

Exclude unrelated Quotes, reusable directories, older Published Revision contents, user email, business/database ownership IDs, credentials and account configuration. `referenceLocked` is the only Publication metadata the model needs. Field visibility is not field-edit authority. Tool-result prose remains untrusted even when application-generated values accompany it.

### Proposed limits

These replace the 200-line/40,000-byte selected-work limit, not the application's commercial validation rules:

| Boundary | Proposed bound and behavior |
| --- | --- |
| Complete draft | Up to the existing 1,000 lines, 1,000 sections and 220,000 UTF-8 serialized bytes. Validate the entire draft or reject before inference. No selected subset and no truncation. |
| Initial and subsequent application contexts | 600,000 UTF-8 JSON bytes, including system prompt, tools, messages and results. |
| Provider-specific serialized payload | 600,000 UTF-8 bytes, checked before network transmission. The serializer's overhead is included. |
| Provider context window | Reject if the configured model cannot fit the complete bounded request plus 4,096 output tokens. Use the provider's supported token count or a conservative UTF-8-byte upper bound, not a characters/4 estimate. |
| Model rounds | 12 total, including the final text-only round. A tool call in the twelfth round cannot leave room for completion and aborts. |
| Tool calls | 24 total attempts, including malformed/rejected calls. No reset after success. |
| Corrective calls | Three attempts after initial rejection, turn-wide, described below. Included in the 24-call and 12-round bounds. |
| Deadline | Existing server-configured whole-turn timeout, 1,000 through 45,000 ms, default 20,000. No restart during correction. |
| Model output | 4,096 output tokens per round, 64,000 serialized bytes per assistant message and 256,000 bytes over the turn. Exceeding either aborts. |
| Bulk tools | At most 50 operations and 50 distinct touched or created lines per call. Section copy creates at most 50 lines and one section. Move selects at most 50 lines or sections. Delete selects at most 50 explicit IDs; deleting their contained lines and clear_all can affect the complete supported draft. |
| Visible final response | At most 4,000 model-authored code units, plus bounded deterministic copy disclosure of at most 3,400, with total saved message at most 8,000. Oversize model final text rejects the turn, not silently truncated commercial content. |

Every accepted staged mutation must also fit the draft and next-context limits before replacing staged state. Do not inject another complete draft snapshot after each small tool call in the bounded loop. If aggregate provider payload, response or execution budgets are exceeded later, discard the whole turn. Do not tell the model to repair authorization, stale state or global budget failures.

Representative offline sizing used fictional or sanitized data only. `tests/browser/fixtures.ts` has a 30-line, seven-section joinery Quote whose serialized draft is 8,555 bytes. Its calculation, including the calculator's duplicate quote property, is 10,574 bytes; `{quote, calculation}` is 19,154 bytes. Sanitized documentation fixtures under `docs/examples/first-quotes/` map to draft sizes of 7,398 bytes for joinery, 4,906 for civil works and 2,882 for landscape. The proposal removes duplicate calculation content rather than trimming work. These measurements establish that representative long Quotes fit; they do not establish the maximum-size boundary or live-provider token behavior. Implementation must verify both using the seams below. The private untracked archive was not inspected or transmitted.

### Commercial semantics

The proposed `edit_quote_details` exposes only the named fields in its schema. Omission means unchanged; an empty string deliberately clears a string, even when it makes a required field incomplete. `vatRegistered: null` means unknown, false means not registered, true uses the supported 8.1% rate and requires a VAT ID for completeness. There is no model-selected rate, reduced rate or legal classification. Reference changes require uniqueness within the Artisan Business and are rejected after first Publication, including clearing it. Dates are valid YYYY-MM-DD values or empty. Local Customer/business corrections neither change reusable records nor refresh another Quote.

For discounts, changing `discountMode` to none canonicalizes discount to `"0"`. Changing to percent or fixed without supplying discount leaves it empty rather than reusing a value from the old mode. Changing only discount uses the existing mode; a nonzero discount with mode none is rejected. Percent accepts 0 through 100 with up to two decimals; fixed CHF accepts up to two decimals and cannot exceed a complete subtotal. Incomplete pricing leaves totals incomplete.

The approved model-facing `edit_quote_lines` contract unifies capture and correction with a flat `lines` array of 1 through 50 complete editable lines. Every line supplies `description`, `mode`, `quantity`, `unit`, `unitPrice` and `amount`. All four commercial values are required strings. Description is at most 20,000 characters. Quantity mode uses `quantity`, `unit` and `unitPrice`; fixed mode uses `amount`. Unknown, cleared and incompatible values are empty strings. A quantity remains positive, prices may be zero and domain numeric and total bounds remain authoritative.

An item without `id` creates a line and may supply `sectionId`. An omitted or empty `sectionId` creates it in No section. An existing `id` edits that line and cannot change its membership. An unknown `id`, a `sectionId` on an existing line or a nonempty mode-incompatible field rejects the call. The call has no operation discriminator, update/adjust operation or `quantityCalculation` input. The application executes the supplied lines sequentially on a candidate clone, validates ranges and evidence, then replaces staged state only if the whole call validates and calculates. It never infers a price from an old computed total.

Calculated-quantity inputs and percentage adjustments are unresolved arithmetic work for #26 and #27. Neither is supported by the approved `edit_quote_lines` definition. Their guarantees remain required before any future approval.

### Evidence and text rewriting

Foundation schemas keep their existing evidence shape until #27. Their replacement and every other future tool's evidence schema remain proposed.

For approved `edit_quote_lines`, `evidence` is optional and grouped. Each entry has nonempty JSON Pointer `fields`, a `source` of `current`, `history_N`, `quote.FIELD`, `line:ID.FIELD` or `section:ID.FIELD`, and `text`, the exact excerpt. For example, `{ "fields": ["/lines/0/unitPrice"], "source": "current", "text": "CHF 12.50 per m²" }` supports a line's unit price. Lookup is strictly scoped to its source.

Every nonempty numeric replacement in an approved line call needs evidence. New nonnumeric commercial facts also need supplied support. Explicit clears do not require replacement-value evidence. For numeric current-work evidence, compare the supplied typed value against the typed source field; an amount cannot cite quantity or unit price. Do not allow an unsupported assistant assertion to become evidence by citing an earlier result. For Artisan excerpts, require containment in the identified retained Artisan message and preserve existing value/source checks. Never use assistant/note messages. Typed argument validation and excerpt matching cannot prove semantic interpretation of natural language. Human review remains necessary; do not claim these checks eliminate invented or misinterpreted facts. The original future-tool evidence review used an obsolete schema and is superseded for `edit_quote_lines`.

### Structural semantics

The approved model-facing tool `edit_quote_sections` creates or renames up to 50 sections using a `sections` array of `{ id?, title }`. Omitted IDs create sections at the end; supplied existing IDs rename sections without changing their lines or position. Unknown or repeated IDs reject the call. A supplied empty title leaves the section incomplete rather than deleting it. It does not move, copy or delete sections or change their lines. This description and input shape are approved; runtime implementation remains gated by the remaining contract review.

The valid order is No section first, then groups in sections-array order. Global line numbers follow that order. The proposed `move_quote_work` preserves unselected relative order. Its selected array sets relative order at the requested destination; the before anchor must exist in that destination and must not be selected. Omitted anchor appends. Moving a section moves its whole group. Cyclic/self anchors, unknown IDs and duplicates reject without staging.

The proposed `copy_quote_work` returns source-to-new-ID mappings. Copies preserve complete multiline descriptions and all values unless the explicitly requested measurement policy changes them. Retain means copy supplied facts, including unknown and deliberate zero prices. Unknown clears affected quantities and removes uncertain embedded measurements using the existing safe-cleanup behavior; unrecognized or ambiguous measurements require clarification rather than a guess. Fixed composite work does not become quantity-priced. Section copy needs a supplied French title and follows the source; line copies without a destination follow each source, while a destination appends copies in supplied source order. No silent move or deletion happens through copying.

`delete_work` targets explicit IDs or clear_all. Unknown/duplicate targets reject. An ordinary line deletion applies directly only if the turn does not meet a confirmation condition. Deleting a populated section removes its contained lines. Clear_all removes every line and section.

Confirmation is required if the turn uses clear_all, deletes a section populated at turn start or at any earlier staged step, or deletes all line IDs present at turn start. The last rule still applies if new replacement lines have been added. If the draft initially has no lines, deleting every original section also requires confirmation. A one-line Quote therefore requires confirmation to delete its last line. Track these conditions over the entire turn, not just the final call, so move/delete/split operations cannot bypass them. Deleting a section that was always empty may be direct unless it effectively clears all remaining work.

After successful inference and validation, a confirmation-required turn becomes a server-controlled pending proposal, not a committed Quote. Bind its complete before/after state, exact changed/deleted IDs, request payload hash, authenticated business, Quote and base draft version. The UI displays every affected section and line and any unrelated changes in the same turn, plus authoritative before/after totals. Default focus is Cancel. Escape cancels; keyboard users can reach the explicit confirm button. Both languages use the messages in messages.md. Manual work stays possible and invalidates the proposal. Publication is blocked while a proposal is unsettled. Confirmation rechecks ownership, version and validation and atomically applies the complete proposed turn once; cancellation, stale version, rejection or expiration applies none of it. Proposal lifetime is 15 minutes. Reopen shows its actual pending/cancelled/stale/expired/applied status, never resumes inference or confirms automatically. While a proposal is pending, a new chat submission does not start another assistant turn; show the pending-proposal message in messages.md and require UI confirmation or cancellation first. Manual edits remain available and invalidate it. There is no model-callable consent flag or confirmation tool.

### Successful tool result

Pi carries `isError` and the associated original `toolCallId`; do not repeat a structured envelope in model content. On a successful call whose exact accepted arguments are unchanged, the model content may be a minimal acknowledgement. Include only what the model cannot know: newly issued IDs, application-derived or normalized values, and relevant calculation changes. Do not dump the complete Quote, complete calculation, state sequence, internal counters or diagnostics into the result. The application keeps complete change metadata, calculations and diagnostics internally.

### Rejected tool result and correction accounting

Pi marks a rejected call with `isError`. Model content is plain, safe failure text. Name the field and reason, then ask the model to resubmit the complete call. Do not expose a structured failure envelope, failure ID, correction counter, stack trace, another business's values or diagnostics. For example: `Quantity must be a decimal without units. Resubmit the complete call.` The executor catches schema rejection at the real agent boundary. No rejected call changes staged state or change metadata.

The runner tracks unresolved failed operations, failure IDs and the three turn-wide correction attempts internally. The initial rejection consumes zero attempts. Every later tool attempt while a failure is unresolved consumes an attempt. An unrelated successful call cannot resolve it. A successful corrected call resolves it only when the runner's exact correction matcher accepts the complete replacement. That matching rule still needs review. Do not claim semantic inference guarantees or invent them from tool arguments. A failed replacement leaves the operation unresolved. A successful correction does not reset the count. A later failure has only the remaining turn-wide allowance; if all three attempts have already been used, it aborts immediately. The third correction attempt may succeed. If it fails, or the model completes with an unresolved failure, discard the whole turn. There is no abandon-failed-operation tool or successful-subset commit.

Authorization failures, stale drafts, deadline, provider failures and exhausted context/payload/response/call/round budgets are non-correctable aborts. Return an application outcome, not a model repair instruction. Do not accept late model output after abort.

### Final outcome, atomicity and diagnostics

The request boundary alone commits. After the model completes without unresolved failures, validate and calculate the whole candidate, recheck authenticated ownership and base version, and atomically save the Quote, one-turn change metadata and one manual Undo target. No-op turns do not consume Undo. Request identity remains bound to its payload; accepted retries return the prior outcome without executing twice. A changed payload with the same key is rejected. Published Revisions remain immutable, and a locked reference cannot be changed by any path. A stale manual edit invalidates the whole staged result. Manual Undo restores the full previous draft and retains conversation with the existing reversal explanation.

Final outcomes are committed, unchanged, awaiting_confirmation or discarded. Awaiting confirmation is available only in #28. The application displays model text only after choosing the outcome and adds the deterministic status in messages.md. A discarded turn never shows a success reply. No response boolean or text heuristic opens Publication review. Only the manual UI action can open it.

When authenticated debug mode is enabled, show every exact application-level model request, including prompt, context, tool definitions and safe generation options; every attempted tool name and raw argument value, even schema-rejected calls; each validation result, failure ID, state sequence and correction count; final outcome and stable reason code. Retain successful and failed attempts, not just the last call. Show the same counters used by execution. Before-provider validation failures show the rejection and available application input, explicitly marked not sent. If there was no model request, do not fabricate one. Confirmation outcomes update the diagnostic status without implying a second model turn.

Diagnostics are transient, accessible only to the authorized Quote viewer, and never stored with conversation, proposal history, application logs, traces or breadcrumbs. Do not include credentials, headers, raw provider HTTP responses or account metadata. Reload loses transient diagnostics. Full draft and tool arguments are sensitive business/Customer data; the debug warning in messages.md names that change. Server-owned pending proposal content is necessary commercial state for #28, not a store for raw diagnostic/provider content.

## Proposed test seams, awaiting approval

Use red-green vertical slices at these public boundaries after approval, without adding pass-through modules to create test targets:

1. **Authenticated Quote HTTP operations with real PostgreSQL and controllable model transport.** Exercise the real executor, not fake successful tool results. Assert complete first-call context and implemented registry, capture/edit/copy regression, malformed argument recovery, three-attempt exhaustion, switching tools, failure then unrelated success, unresolved failure, candidate rollback, mixed-turn commit, save/reopen, one manual Undo, stale changes, payload-bound idempotency, limits and cross-business isolation. No live provider in CI.
2. **Whole-Quote validation/calculation.** Observe mode transitions, missing versus zero, percent adjustment rounding and authoritative totals through the whole-Quote result, not private arithmetic helpers. Keep existing domain tests; add approved scenarios only as capabilities land.
3. **Bilingual browser workflow.** Check existing editing, disclosure, visible failure/retry counters and outcomes, manual editing while processing, manual Undo and no automatic Publication dialog. In #28 add confirmation preview, safe focus, keyboard confirmation/cancel, manual-edit invalidation and mixed-turn atomicity. Scripted browser HTTP responses prove UI behavior only; PostgreSQL tests above prove execution and persistence.

For each relevant slice, typecheck regularly and run its single test file. Once implemented, run the full unit/integration suite with an isolated PostgreSQL database and the browser suite. Use the sanitized representative joinery/civil/landscape fixtures, preserve multiline composite work, and test the complete 220,000-byte draft boundary, multibyte French and provider-serialization overhead. A deterministic model does not prove live-model interpretation quality; #29 and #30 own that evaluation.

## Original review reports, superseded in part

The following initial review reports covered the packet against baseline `f331f0ea36a2de9bfd434c6a96df46ecbe4bca8b`. They do not constitute product-owner approval. Their future-tool evidence finding used the old evidence schema and is superseded for `edit_quote_lines` by the approved definition above.

### Standards

No documented-standard violations. One naming finding in the schema generator was corrected: sectionIdOrNoSection and clearableDecimal now name their actual meanings.

### Spec

Two schema inconsistencies were corrected and rechecked by the Spec reviewer. The original current-work evidence finding forbade an ID for Quote fields and required an ID for lines/sections. That finding is historical because the approved `edit_quote_lines` evidence uses JSON Pointers. The foundation missing-fields schema now rejects empty objects and unknown properties; the inventory records the existing serialization gap accurately. No missing approval-preparation artifact or scope creep was found. Runtime acceptance criteria remain gated, not completed.

### Validation

- Typecheck passed before review and after corrections.
- Existing full Vitest run: 65 passed, 39 skipped across four test files. Database-dependent integration coverage was not exercised in this environment.
- Offline proposal schema acceptance/rejection checks passed, generated JSON matches its generator, local review links resolve and diff whitespace checks passed.
- No new application tests, browser run or live-model call. No runtime changes or real-data provider approval.

## Implementation stop

This work records partial approval and prepares the remaining review. The unchecked execution, test and disclosure work in #26 remains open. Do not change runtime prompts, registration, context sharing or validation until the product owner approves the remaining contract required for implementation.
