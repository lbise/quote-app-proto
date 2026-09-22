# Quote AI

The Quote assistant is part of every Easy Quote instance. It uses the configured provider and model for each request. The current provider is Google Gemini through pi's Google provider.

This is a development application. Do not enter sensitive, confidential, or real Customer data until the provider, plan, region, retention and data-processing terms have been reviewed for the intended use. The chat header provides this warning without blocking the conversation.

## Configuration

The server owns the provider, model, credential and request limits. An Artisan cannot supply an endpoint, credential, provider or model. The provider must be registered in `app/lib/quote-ai-config.server.ts`, and the model must exist in that provider's pi catalog. A change requires a server restart. There is no endpoint setting or fallback provider/model.

Required environment variables:

| Variable | Value |
| --- | --- |
| `QUOTE_AI_PROVIDER` | Registered provider, currently `google` |
| `QUOTE_AI_MODEL` | Model in that provider's pi catalog, currently `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | Runtime secret, never browser-visible |
| `QUOTE_AI_TIMEOUT_MS` | Optional integer from `1000` through `45000`, default `20000` |
| `QUOTE_AI_DEBUG` | Optional `true`; exposes safe failure diagnostics in the authenticated Quote UI |

Copy `.env.example` to `.env` and put the Gemini key in the local file or shell environment. Never commit the key. The server validates this configuration at startup and refuses to serve requests when it is incomplete or invalid.

The root loader sends only the provider's public name to the browser. It never sends a credential. The disclosure explains that the current message, recent conversation and the complete current Working Draft may leave Easy Quote, including copied Customer and business details, VAT information, reference and dates, project and work-site details, terms, discounts, lines, sections and calculated amounts. Unrelated Quotes, older Published Revisions, reusable-record directories and credentials are excluded.

## Data and assistant boundaries

Do not write raw conversations, Quote descriptions, provider payloads or provider responses to application logs, traces or error-reporting breadcrumbs. When `QUOTE_AI_DEBUG=true`, every successful assistant response shows its successfully executed tool calls and request ID transiently in the authenticated Quote chat; the calls are not stored in the database. A failed request exposes a phase, stable reason code, tool name, the full failed tool call, the request ID, and the exact application-level LLM request in the authenticated Quote UI. The LLM request includes the system prompt, converted conversation messages, tool definitions, model identity and safe generation options. The tool call and request can contain Artisan-supplied or Customer data, so enable this only while diagnosing a deployment and disable it afterward; credentials and provider responses remain excluded. The provider may serialize this application-level request into a provider-specific HTTP payload. The assistant cannot publish, send or accept a Quote. The Artisan reviews quantities, prices, technical content and applied changes before Publication.

The assistant's approved tools are `edit_quote_details`, `edit_quote_lines`, `edit_quote_sections`, `copy_quote_work`, `move_quote_work` and `delete_quote_lines`. `edit_quote_details` changes named Working Draft fields only: reference, title, dates, work-site address, copied Customer and business details, terms, VAT registration and identifier, and Discount. A published Quote's reference stays locked. These Customer and business fields belong to this Quote only. The assistant cannot read, create or update reusable Customer records or business defaults.

`edit_quote_lines` creates or edits one through fifty complete lines in a call. An existing stable ID edits that line; an omitted ID creates a line. A new line may name an existing section, but the tool cannot move an existing line. Each submitted line includes its description, mode, quantity, unit, unit price and fixed amount. Empty strings represent unknown, deliberately cleared or mode-incompatible values. Structural tools perform copying and movement separately.

`edit_quote_sections` renames existing sections or creates new sections at the end in a bounded batch. `copy_quote_work` copies explicit lines or one section with fresh IDs, preserving multiline content and values unless the Artisan chooses the reviewed unknown-measurement policy. `move_quote_work` reorders explicit lines within or across sections, including No section, or reorders sections while preserving unrelated work. `delete_quote_lines` deletes only explicitly identified lines. Deleting a whole section, clearing all work, or deleting the last/all original lines is manual-only; a rejected destructive request discards the complete assistant turn. These structural operations use stable IDs, validate each batch atomically, and remain one manual Undo target when successful.

The complete authenticated Working Draft, its authoritative calculation, bounded recent conversation and current Artisan message are supplied in trusted application context before the first model call. No `read_work` call is needed. This context includes Quote-level commercial fields, every line and section with stable IDs and order, and calculated amounts. Tools receive no model-chosen business or Quote identifiers. New line, section and copy IDs come from the application.

Structural IDs and ordering are application-owned. A copy with unknown measurements clears affected quantity fields and recognised measurements in its description while retaining other source values. The server adds a bounded deterministic disclosure of copied values to the reply.

The model sends editable commercial values as typed tool arguments. A grouped citation has `fields`, `source` and `text`. `fields` names every argument field supported by the citation. `source` is `current`, an available Artisan `history_N` message, or an original Working Draft field such as `quote.FIELD`, `line:ID.FIELD` or `section:ID.FIELD`. `text` is an exact excerpt from that source. Assistant replies cannot establish evidence, and one citation may cover several fields.

New lines and changed modes require `/lines/N/mode`. Each changed nonempty line description, quantity, unit, unit price and fixed amount needs its matching `/lines/N/...` field. Created or renamed section titles require `/sections/N/title`; section copies require `/source/title`. Detail edits use plain detail names, not JSON Pointers. Unchanged values, cleared values and structural IDs need no citation. A derived value cites its operands, not a calculation claim.

The application checks tool shape, source identity, excerpt containment, field types, precision, bounds, pricing modes and whole-Quote validity. It does not prove a faithful rewrite or verify model-derived quantity, formula or price arithmetic. It calculates and remains authoritative for line amounts, subtotals, Discount, VAT and totals. A `missing_evidence` rejection lists the exact fields without citations, including pricing mode and unit. The model should add supporting citations for those fields and resubmit the complete call. Invalid evidence sources or excerpts remain rejected. Unknown values stay empty rather than becoming zero. The assistant asks a focused question when the target or commercial fact is ambiguous.

Each request creates a fresh agent and temporary Working Draft. A turn has at most twelve model responses, twenty-four tool-call attempts and three failed tool calls. The first two rejected calls leave earlier successful staged calls available for a normal one-turn commit, and the application reports that failure status. The third rejected call stops the turn and discards every staged change. Tools run sequentially and each call is atomic, including a line batch. The server validates and calculates the complete Quote, checks its version and commits a successful turn as one manual Undo target. Provider failure, invalid results, timeout, stale state or an exhausted budget discards staged changes. Request IDs prevent duplicate accepted changes, and manual saves invalidate stale assistant results.

Limits include:

- Current message: 8,000 characters.
- Conversation: 24 whole messages and 24,000 characters.
- Complete Working Draft: 1,000 lines, 1,000 sections and 220,000 serialized UTF-8 bytes; it is rejected rather than truncated.
- Application context and provider payload: 600,000 UTF-8 bytes each.
- Model response: 64,000 bytes each and 256,000 bytes per turn.
- Model-authored reply: 4,000 characters, plus up to 3,400 characters of bounded copied-value disclosure; the saved message is limited to 8,000 characters.

## Provider terms

Google's Gemini API terms and pricing can change. Free-tier Gemini API use may allow Google to use submitted content and generated responses to improve products, and human reviewers may process API input and output. Paid services have different data-use terms but can still retain logs for safety, security and legal obligations. Regional rules may limit which service is available.

The application does not claim zero retention, no training or production approval. Check the current terms for the account and region before using real Artisan Business or Customer data. A local development server is not a privacy boundary.

## Before real-data use

1. Choose the Google plan and verify its current data-use, retention and regional terms.
2. Verify the account or project settings for the intended data handling.
3. Record the review in the deployment change and update this document and the disclosure if the provider or terms differ.
4. Complete configured-provider rehearsal and release acceptance in [#21](https://github.com/lbise/quote-app-proto/issues/21).

The assistant is intentionally always configured. Authorization remains separate: verified sessions, the explicit `AUTH_ALLOWED_EMAILS` allowlist, trusted origins, business-scoped database access and server-side mutation validation still apply.
