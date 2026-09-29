# Quote AI

The Quote assistant is part of every Easy Quote instance. It uses the configured provider and model for each request. A deployment chooses one of two registered providers: direct Google Gemini through pi's Google provider, or OpenRouter with one exact model. Direct Google is the default configuration. OpenRouter is not yet approved for real Artisan data (#38).

This is a development application. Do not enter sensitive, confidential, or real Customer data until the provider, plan, region, retention, and data-processing terms have been reviewed for the intended use. The chat header provides this warning without blocking the conversation.

## Configuration

The server owns the provider, model, credential, generation settings, and request limits. An Artisan cannot supply an endpoint, credential, provider, or model. The provider must be registered in `app/lib/quote-ai-config.server.ts`. A change requires a server restart. There is no endpoint setting or fallback provider, model, route, or generation setting.

| Variable | Value |
| --- | --- |
| `QUOTE_AI_PROVIDER` | `google` or `openrouter` |
| `QUOTE_AI_MODEL` | Google: a model in pi's Google catalog, for example `gemini-3.5-flash-lite`. OpenRouter: an exact `author/model` ID |
| `GEMINI_API_KEY` | Google runtime secret, never browser-visible |
| `OPENROUTER_API_KEY` | OpenRouter runtime secret, never browser-visible |
| `QUOTE_AI_REASONING` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`, if the model supports it. Required when the model cannot turn reasoning off |
| `QUOTE_AI_MAX_OUTPUT_TOKENS` | Optional output-token limit per model call, default `4096`, at most the model's limit |
| `QUOTE_AI_SPEND_LIMIT_USD` | Required for OpenRouter. Cumulative spending ceiling for the deployment, with at most 9 decimals |
| `QUOTE_AI_TIMEOUT_MS` | Optional integer from `1000` through `45000`, default `20000` |
| `QUOTE_AI_DEBUG` | Optional `true`, for development only; exposes safe failure diagnostics in the authenticated Quote UI. It is separate from [Turn Traces](#turn-traces) |
| `QUOTE_STT_PROVIDER` | Optional transcription provider for dictation. Defaults to `QUOTE_AI_PROVIDER`. Only `google` is implemented |
| `QUOTE_STT_MODEL` | Optional transcription model. Defaults to `QUOTE_AI_MODEL`. Required when `QUOTE_STT_PROVIDER` differs from `QUOTE_AI_PROVIDER` |

Copy `.env.example` to `.env` and put the key in the local file or shell environment. Never commit the key. The server validates this configuration at startup, without network calls, and refuses to start when it is incomplete or invalid. Only the selected provider's key is used; the other key is never sent.

### Generation settings

Each model call uses the same validated reasoning level and output-token limit, including follow-up calls after tool results. A level is accepted only when the model genuinely supports it. The SDK would otherwise substitute a different level, and the recorded setting would be false. For example, Gemini 3 Flash models, including `gemini-3.5-flash-lite`, cannot turn reasoning off; the SDK would send MINIMAL. These models require an explicit `QUOTE_AI_REASONING` such as `minimal`. When `QUOTE_AI_REASONING` is unset, the assistant uses `off` only if the model supports it and otherwise refuses to run. Debug diagnostics show the effective settings of each call.

### OpenRouter

OpenRouter support uses the public OpenRouter model metadata, not the SDK's bundled catalog. Before a request, the server resolves the exact configured model and requires text input and output, custom tools, an output-token limit, and priced, bounded endpoints. Every endpoint OpenRouter may route to must meet these requirements. A successful check is reused for at most 15 minutes. An unknown or incompatible model, unavailable metadata, or unsupported reasoning or output settings refuse the request. Nothing is sent, and there is no fallback.

Every call pins the model and credential and uses `require_parameters: true`, `allow_fallbacks: false`, no prompt caching, and no retries. Routed model and provider identity, and usage counts, are checked on the response. A different routed model or missing, partial, or inconsistent usage stops the turn and discards staged changes.

### Spending limit (OpenRouter)

This is an interim policy until #38 records the final spending decision.

- **Scope**: one cumulative allowance per deployment database, shared by every Artisan and server process.
- **Reservation**: before each model call, the server atomically reserves the most that call can cost. It uses the highest verified rates across routable endpoints: a full context window at the highest input or cache rate, every output token at output plus reasoning rates, and the request fee. Rates round up. A request that cannot be priced or bounded is refused.
- **Settlement**: when the response has complete, consistent usage, the reservation is reduced to the estimated cost, which is the larger of the token estimate and OpenRouter's reported cost. After a provider error, timeout, cancellation, incomplete stream, or uncertain usage, the full reservation stays.
- **Exhaustion**: when the next reservation would exceed `QUOTE_AI_SPEND_LIMIT_USD`, the turn stops before anything is sent, staged changes are discarded, and the chat tells the Artisan that the limit is reached.
- **Reset**: none. The operator raises `QUOTE_AI_SPEND_LIMIT_USD` to allow more spending. The reserved total is in the `quote_ai_spend` table.

This is an application-side bound under published rates. It is not an invoice or an account-wide guarantee; configure OpenRouter account limits separately. Direct Google assistant calls have no application spending limit (#38). Dictation transcription counts against the same allowance whenever `QUOTE_AI_SPEND_LIMIT_USD` is set, including with direct Google; see [Dictation](#dictation).

## Dictation

The conversation composer has a microphone button. The Artisan records up to five minutes, the server transcribes the audio, and the transcript is appended to the composer. The Artisan reviews it and sends it as a normal Artisan message. Nothing is sent automatically.

- **Upload**: the browser posts the raw recording to the authenticated `POST /api/transcriptions`, in its native format: webm/opus on Chrome and Android, mp4/aac on iOS Safari, ogg/opus on Firefox. The server identifies the format from the bytes and rejects anything else, and anything over 5 MiB.
- **Boundary**: `app/lib/transcription.server.ts` takes audio and format and returns transcript text and cost. It uses `QUOTE_STT_PROVIDER`/`QUOTE_STT_MODEL`, falling back to the assistant's provider and model. Direct Gemini is the only implementation. It sends the audio inline in one `generateContent` call, because pi's message content supports only text and images. When the assistant uses OpenRouter and no `QUOTE_STT_*` setting is present, dictation is unavailable and the microphone button is hidden. An explicit setting the server cannot honour stops startup.
- **Prompt**: plain transcription in the spoken language, with punctuation, filler words kept, and numbers written as spoken. The prompt forbids answering, following, translating or summarizing the dictated content. `gemini-3.5-flash-lite` sometimes still writes spoken numbers and units as digits and symbols, for example "75 m²".
- **Spending**: when `QUOTE_AI_SPEND_LIMIT_USD` is set, each transcription reserves the most it can cost before sending: a full context window of audio input and every output token. After a response with complete usage, the reservation is reduced to the estimated cost. After an error, timeout, cancellation or missing usage, the full reservation stays. pi's catalog lists only text input rates, so audio input is priced at 7 times the text rate, the highest audio-to-text ratio in Google's published Gemini pricing. This overstates spend rather than understating it. Without a limit, direct Google transcription has no application spending limit.
- **Retention**: audio stays in server memory for one request and is never stored or logged. The transcript is not logged. In the browser, a failed recording stays in the tab's memory for Retry until the tab is closed or reloaded. There is no offline storage.
- **Quality measurement**: `quote_message.dictated` records whether an Artisan message was dictated. For dictated messages, `quote_message.dictation_edit_ratio` records the character edit distance between the returned transcript and the sent text, divided by the longer length (0 means sent unchanged). Text typed before the first dictation is not counted as an edit. No audio or transcript text is stored.

Direct Gemini transcription is for development and testing only: your own voice and invented Quotes. Before any real Artisan or Customer audio is sent, the transcription provider must offer zero data retention and no training on inputs. Choosing the production transcription model is tracked in #43.

## Data sharing and review

Before the first model call, the application may send the current Artisan message, bounded recent conversation, complete current Working Draft, and authoritative calculation. The draft can include copied Customer and business details, VAT information, reference and dates, project and work-site details, terms, discounts, every line and section, and calculated amounts.

Dictated audio is sent to the configured transcription provider, not to the assistant model. Easy Quote does not keep it.

It excludes unrelated Quotes, older Published Revisions, reusable-record directories, credentials, ownership IDs, and account configuration. The provider may retain or use submitted data under its terms. This documentation does not approve real-data use.

The Artisan reviews quantities, prices, technical content, wording, and applied changes before Publication. A valid tool call cannot prove that the assistant interpreted the request correctly. The assistant cannot publish, send, accept, create a Quote or later Working Draft, or perform Undo.

Administrators can read every Quote and its conversation. The in-app disclosure tells the Artisan this, and that Turn Traces are kept for up to 30 days.

Do not write raw conversations, Quote descriptions, provider payloads, or provider responses to application logs, traces, or error-reporting breadcrumbs. They are stored only in Turn Traces. Debug mode is a development switch. It may temporarily show the authorized Quote viewer the application-level request and attempted calls, which can contain the complete draft and Customer data. Credentials and provider responses stay out of debug output.

### Turn Traces

Every Assistant Turn leaves a Turn Trace in the `turn_trace` table ([ADR 0007](adr/0007-store-turn-traces-temporarily-for-administrators.md)). This replaces the earlier rule against keeping provider payloads and responses. A turn gets one when it commits, changes nothing, or is discarded, including a provider failure. A turn that stops before any model call gets one too, with the error and the context that would have been sent. A stale Working Draft, a draft over the limits, the spending limit and a missing provider configuration all stop a turn this way. A turn refused before its Quote is found, such as a request for another business's Quote, has no Turn Trace.

A Turn Trace contains:

- for each model call, the provider payload as the SDK built it (system prompt, tool definitions, messages and application context), the provider response with its text, reasoning, tool calls and stop reason, and the provider, model, token usage, cost and latency. A call stopped before the provider built a payload keeps the model context instead;
- each tool call's arguments and its result or rejection, in order;
- the outcome (`committed`, `unchanged` or `discarded`) and, when discarded, the reason code;
- the Working Draft version before and after, the locale, the User, the Quote, the Artisan's message, and the assistant message or note the turn left in the conversation.

Credential fields such as API keys and authorization headers are replaced with `[redacted]`, and so is any configured provider key found in the text. Speech-to-text requests are not traced.

Only Administrators can read Turn Traces (`readTurnTraces`, `listTurnTraces` and `readTurnTrace` in `app/lib/turn-traces.server.ts`), in the admin area described in [deployment](deployment.md#administrators). Each trace also stores an outcome kind for filtering (`outcome_kind`): committed, committed with failed calls, unchanged, discarded, provider error, or failed before any model call. A model call counts as sent once the provider built its payload or answered. A Turn Trace is deleted with its Quote, and 30 days after its turn. The server deletes expired traces a minute after start and every hour after that, and again whenever it records a trace. Expired traces are never returned while they wait for deletion. If a Turn Trace cannot be stored, the turn still succeeds or fails as it would have, and the server logs a fixed message with no turn content.

Storage keeps the whole trace without truncation. A model call may send up to 600,000 bytes and a turn has at most twelve model responses. The `detail` column is `json`, not `jsonb`, so a payload keeps its key order.

## Tool boundary

The replacement tools are `edit_quote_details`, `edit_quote_lines`, `edit_quote_sections`, `copy_quote_work`, `move_quote_work`, and `delete_quote_lines`. They take direct commercial and structural arguments. They do not require source excerpts or provenance fields.

`edit_quote_details` changes only named Quote-level fields. `edit_quote_lines` creates or edits one through fifty complete lines. Existing IDs edit their line; omitted IDs create a new line. Quantity mode uses quantity, unit, and unit price. Fixed mode uses amount. Empty strings represent unknown, cleared, or mode-incompatible values. New lines may name a section but cannot move existing lines.

`edit_quote_sections` creates sections or renames existing ones. `copy_quote_work` copies explicit lines or one section with fresh IDs. `move_quote_work` reorders explicit lines or sections. `delete_quote_lines` removes only explicit line IDs. A whole section, all work, or the last original line is manual-only.

The application validates tool shape, field types, decimal precision, ranges, pricing modes, stable targets, batch bounds, and whole-Quote validity. It calculates line amounts, subtotals, Discount, VAT, and totals. It does not verify the source of a value, natural-language interpretation, faithful rewriting, formula selection, or arithmetic behind a model-supplied quantity or price adjustment. Unknown values stay empty rather than becoming zero. The assistant asks a focused question when a target or commercial fact is ambiguous.

Each request uses a fresh agent and temporary Working Draft. A turn has at most twelve model responses, twenty-four tool-call attempts, and three rejected calls. The first two rejected calls leave earlier successful staged calls available for a normal one-turn commit. The third rejected call discards every staged change. Tools run sequentially and each call is atomic. The server validates and calculates the complete Quote, checks its version, and commits a successful turn as one manual Undo target. Provider failure, invalid results, timeout, stale state, or an exhausted budget discards staged changes.

Limits include an 8,000-character current message, 24 whole conversation messages within 24,000 characters, and a complete Working Draft of up to 1,000 lines, 1,000 sections, and 220,000 serialized UTF-8 bytes. The draft is rejected rather than truncated. Application context and provider payload each allow 600,000 UTF-8 bytes. Model responses allow 64,000 bytes each and 256,000 bytes per turn.

## Provider terms

The OpenRouter account, plan, upstream routing, training and data-use, region, and retention terms have not been reviewed. Do not send real Artisan Business or Customer data through OpenRouter until #38 records that decision and updates this document and the in-app disclosure.

Google's Gemini API terms and pricing can change. Free-tier Gemini API use may allow Google to use submitted content and generated responses to improve products, and human reviewers may process API input and output. Paid services have different data-use terms but can still retain logs for safety, security, and legal obligations. Regional rules may limit which service is available.

Check the current terms for the account and region before using real Artisan Business or Customer data. A local development server is not a privacy boundary.

## Before real-data use

1. Choose the provider and plan and verify its current data-use, retention, and regional terms. For OpenRouter, this includes the upstream providers it may route to (#38).
2. Verify the account or project settings for the intended data handling.
3. For dictation, choose a transcription provider with zero data retention and no training on inputs (#43). Direct Gemini transcription does not meet this.
4. Record the review in the deployment change and update this document and the disclosure if the provider or terms differ.
5. Complete configured-provider rehearsal and release acceptance in [#21](https://github.com/lbise/quote-app-proto/issues/21).

The assistant is intentionally always configured. Authorization remains separate: verified sessions of active (not blocked) Users, the explicit `AUTH_ALLOWED_EMAILS` sign-up allowlist, trusted origins, business-scoped database access, and server-side mutation validation still apply.
