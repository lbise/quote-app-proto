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

The root loader sends only the provider's public name to the browser. It never sends a credential. The disclosure explains that the current message, useful conversation history and permitted Quote work may leave Easy Quote. Saved Customer and Artisan Business fields, the VAT identifier, Quote reference, dates, work-site address and terms are not added to provider context. Customer details included in the current message can still be transmitted and copied into this Quote only.

## Data and assistant boundaries

Do not write raw conversations, Quote descriptions, provider payloads or provider responses to application logs, traces or error-reporting breadcrumbs. When `QUOTE_AI_DEBUG=true`, every successful assistant response shows its successfully executed tool calls and request ID transiently in the authenticated Quote chat; the calls are not stored in the database. A failed request exposes a phase, stable reason code, tool name, the full failed tool call, the request ID, and the exact application-level LLM request in the authenticated Quote UI. The LLM request includes the system prompt, converted conversation messages, tool definitions, model identity and safe generation options. The tool call and request can contain Artisan-supplied or Customer data, so enable this only while diagnosing a deployment and disable it afterward; credentials and provider responses remain excluded. The provider may serialize this application-level request into a provider-specific HTTP payload. The assistant cannot publish, send or accept a Quote. The Artisan reviews quantities, prices, technical content and applied changes before Publication.

The targeted tools are `read_work`, `set_customer_info`, `add_quote_line`, `supply_missing_line_fields`, `update_quote_line`, `create_quote_section`, `rename_quote_section`, `move_quote_line`, `duplicate_quote_line` and `duplicate_quote_section`. They receive the authenticated Working Draft from trusted server context, not business or Quote identifiers chosen by the model. New lines, sections and copied work get application-generated IDs. Existing line corrections use stable IDs and numeric evidence; description and unit replacements must be Artisan-authored or retained from the current work. For supported measurement conversions, the model sends typed dimensions and a calculation kind; the application performs the arithmetic instead of parsing prose. Room wall area uses perimeter × wall height. Section and copy operations are bounded and validated in the application. Copying with unknown measurements clears affected quantities and uncertain measurements in descriptions while retaining other source values. The server adds a bounded deterministic disclosure of copied values to the assistant reply. Discounts, title changes, publication and whole-draft replacement remain unavailable in the assistant flow.

The model extracts commercial values from the current Artisan message or retained Artisan messages and sends them as typed tool arguments. The application validates their types, ranges and calculations; evidence source excerpts are checked against trusted Artisan text, but the application does not parse natural-language measurements. Explicitly clearing a numeric field as unknown uses `clearFields` and does not require a replacement value. Assistant replies cannot establish evidence. Quantities and prices remain missing unless supplied. The application validates and calculates amounts. The assistant must ask focused clarification when a target or commercial fact is ambiguous.

Each request creates a fresh agent and temporary Working Draft. A turn has at most six model rounds and twelve tool calls. Tools execute sequentially. The server validates and calculates the whole Quote, checks its version and commits one successful turn with one Undo target. Provider or tool failure, invalid results, timeout or an exhausted budget discards staged changes. Request IDs prevent duplicate accepted changes, and manual saves invalidate stale assistant results.

Limits include:

- Current message: 8,000 characters.
- Conversation: 24 whole messages and 24,000 characters.
- Selected work: 200 lines and 40,000 UTF-8 bytes.
- Outgoing context and provider payload: 200,000 bytes.
- Model response: 64,000 bytes each and 256,000 bytes per turn.
- Visible final reply: 4,000 characters.

## Provider terms

Google's Gemini API terms and pricing can change. Free-tier Gemini API use may allow Google to use submitted content and generated responses to improve products, and human reviewers may process API input and output. Paid services have different data-use terms but can still retain logs for safety, security and legal obligations. Regional rules may limit which service is available.

The application does not claim zero retention, no training or production approval. Check the current terms for the account and region before using real Artisan Business or Customer data. A local development server is not a privacy boundary.

## Before real-data use

1. Choose the Google plan and verify its current data-use, retention and regional terms.
2. Verify the account or project settings for the intended data handling.
3. Record the review in the deployment change and update this document and the disclosure if the provider or terms differ.
4. Complete configured-provider rehearsal and release acceptance in [#21](https://github.com/lbise/quote-app-proto/issues/21).

The assistant is intentionally always configured. Authorization remains separate: verified sessions, the explicit `AUTH_ALLOWED_EMAILS` allowlist, trusted origins, business-scoped database access and server-side mutation validation still apply.
