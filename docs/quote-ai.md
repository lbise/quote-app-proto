# Quote AI

The Quote assistant is part of every Easy Quote instance. It uses the configured provider and model for each request. The current provider is Google Gemini through pi's Google provider.

This is a development application. Do not enter sensitive, confidential, or real Customer data until the provider, plan, region, retention, and data-processing terms have been reviewed for the intended use. The chat header provides this warning without blocking the conversation.

## Configuration

The server owns the provider, model, credential, and request limits. An Artisan cannot supply an endpoint, credential, provider, or model. The provider must be registered in `app/lib/quote-ai-config.server.ts`, and the model must exist in that provider's pi catalog. A change requires a server restart. There is no endpoint setting or fallback provider/model.

| Variable | Value |
| --- | --- |
| `QUOTE_AI_PROVIDER` | Registered provider, currently `google` |
| `QUOTE_AI_MODEL` | Model in that provider's pi catalog, currently `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | Runtime secret, never browser-visible |
| `QUOTE_AI_TIMEOUT_MS` | Optional integer from `1000` through `45000`, default `20000` |
| `QUOTE_AI_DEBUG` | Optional `true`; exposes safe failure diagnostics in the authenticated Quote UI |

Copy `.env.example` to `.env` and put the Gemini key in the local file or shell environment. Never commit the key. The server validates this configuration at startup and refuses to serve requests when it is incomplete or invalid.

## Data sharing and review

Before the first model call, the application may send the current Artisan message, bounded recent conversation, complete current Working Draft, and authoritative calculation. The draft can include copied Customer and business details, VAT information, reference and dates, project and work-site details, terms, discounts, every line and section, and calculated amounts.

It excludes unrelated Quotes, older Published Revisions, reusable-record directories, credentials, ownership IDs, and account configuration. The provider may retain or use submitted data under its terms. This documentation does not approve real-data use.

The Artisan reviews quantities, prices, technical content, wording, and applied changes before Publication. A valid tool call cannot prove that the assistant interpreted the request correctly. The assistant cannot publish, send, accept, create a Quote or later Working Draft, or perform Undo.

Do not write raw conversations, Quote descriptions, provider payloads, or provider responses to application logs, traces, or error-reporting breadcrumbs. Debug mode may temporarily show the authorized Quote viewer the application-level request and attempted calls. They can contain the complete draft and Customer data. Credentials and provider responses remain excluded.

## Tool boundary

The replacement tools are `edit_quote_details`, `edit_quote_lines`, `edit_quote_sections`, `copy_quote_work`, `move_quote_work`, and `delete_quote_lines`. They take direct commercial and structural arguments. They do not require source excerpts or provenance fields.

`edit_quote_details` changes only named Quote-level fields. `edit_quote_lines` creates or edits one through fifty complete lines. Existing IDs edit their line; omitted IDs create a new line. Quantity mode uses quantity, unit, and unit price. Fixed mode uses amount. Empty strings represent unknown, cleared, or mode-incompatible values. New lines may name a section but cannot move existing lines.

`edit_quote_sections` creates sections or renames existing ones. `copy_quote_work` copies explicit lines or one section with fresh IDs. `move_quote_work` reorders explicit lines or sections. `delete_quote_lines` removes only explicit line IDs. A whole section, all work, or the last original line is manual-only.

The application validates tool shape, field types, decimal precision, ranges, pricing modes, stable targets, batch bounds, and whole-Quote validity. It calculates line amounts, subtotals, Discount, VAT, and totals. It does not verify the source of a value, natural-language interpretation, faithful rewriting, formula selection, or arithmetic behind a model-supplied quantity or price adjustment. Unknown values stay empty rather than becoming zero. The assistant asks a focused question when a target or commercial fact is ambiguous.

Each request uses a fresh agent and temporary Working Draft. A turn has at most twelve model responses, twenty-four tool-call attempts, and three rejected calls. The first two rejected calls leave earlier successful staged calls available for a normal one-turn commit. The third rejected call discards every staged change. Tools run sequentially and each call is atomic. The server validates and calculates the complete Quote, checks its version, and commits a successful turn as one manual Undo target. Provider failure, invalid results, timeout, stale state, or an exhausted budget discards staged changes.

Limits include an 8,000-character current message, 24 whole conversation messages within 24,000 characters, and a complete Working Draft of up to 1,000 lines, 1,000 sections, and 220,000 serialized UTF-8 bytes. The draft is rejected rather than truncated. Application context and provider payload each allow 600,000 UTF-8 bytes. Model responses allow 64,000 bytes each and 256,000 bytes per turn.

## Provider terms

Google's Gemini API terms and pricing can change. Free-tier Gemini API use may allow Google to use submitted content and generated responses to improve products, and human reviewers may process API input and output. Paid services have different data-use terms but can still retain logs for safety, security, and legal obligations. Regional rules may limit which service is available.

Check the current terms for the account and region before using real Artisan Business or Customer data. A local development server is not a privacy boundary.

## Before real-data use

1. Choose the Google plan and verify its current data-use, retention, and regional terms.
2. Verify the account or project settings for the intended data handling.
3. Record the review in the deployment change and update this document and the disclosure if the provider or terms differ.
4. Complete configured-provider rehearsal and release acceptance in [#21](https://github.com/lbise/quote-app-proto/issues/21).

The assistant is intentionally always configured. Authorization remains separate: verified sessions, the explicit `AUTH_ALLOWED_EMAILS` allowlist, trusted origins, business-scoped database access, and server-side mutation validation still apply.
