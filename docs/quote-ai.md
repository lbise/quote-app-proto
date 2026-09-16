# Quote AI

Easy Quote has no approval to process real Artisan Business or Customer data with hosted AI. `QUOTE_AI_ENABLED` stays `false` in normal development and deployment. The only live experiment allowed now is the isolated fictional-data workflow below.

The server owns provider, model, credentials, and request limits. An Artisan never supplies an endpoint, credential, provider, or model. Pi's Google provider factory registers the Gemini Developer API and its catalog. `QUOTE_AI_PROVIDER=google` and `QUOTE_AI_MODEL=gemini-3.5-flash-lite` are the initial test values. A model change selects another model already in that registered catalog and requires a restart. An unknown provider or model fails. There is no endpoint setting and no fallback provider or model.

## What can leave Easy Quote

The assistant request may include the Artisan's current message, the bounded conversation needed to answer it, and permitted Quote work content. Saved Customer and Artisan Business fields, VAT identifier, Quote reference, dates, work-site address, and terms are not added to the provider context. If the Artisan includes Customer name, address, or contact details in the current message, the message may contain and transmit them so the assistant can copy them into the current Quote only. No reusable Customer record is exposed. The restriction does not anonymize a message.

Do not write raw conversations, Quote descriptions, provider payloads, or provider responses to application logs, traces, or error-reporting breadcrumbs. The assistant cannot publish, send, or accept a Quote. The Artisan must review quantities, prices, technical content, and applied changes before Publication.

The root loader sends only the enabled state, public provider name, and processing mode to `app/components/quotes/assistant-disclosure.tsx`. It never sends a credential or review reference. The dialog distinguishes disabled AI, the fictional test, and a production-gated configuration. A production gate is not presented as proof that real-data processing is approved.

## Initial-capture tools and execution limits

`@earendil-works/pi-ai` supplies the provider connection and `@earendil-works/pi-agent-core` runs the tool loop in this backend. No coding-agent harness, local extensions, filesystem sessions, or shell tools are loaded. Each request creates its own agent and temporary Working Draft.

Only `read_work`, `set_customer_info`, `add_quote_line`, and `supply_missing_line_fields` are registered. `set_customer_info` can copy explicit Customer name, address, and contact details from the Artisan's message into the current Quote; it cannot create or modify a reusable Customer record. Tools receive the authenticated draft from the server, not business or Quote IDs from the model. New lines get application UUIDs. Follow-up may fill empty fields only on lines captured in this flow. Server-owned capture eligibility survives reopening and Undo. A manual line edit revokes its eligibility; unrelated lines retain theirs. Publication clears eligibility for the next Working Draft.

Numeric mutations require evidence from the current Artisan message, retained Artisan messages, or the same numeric field on an original Working Draft line. Assistant replies cannot establish evidence. Numeric matching does not prove that the model understood a technical reference or chose the intended work. Ambiguity calls for focused clarification, and the Artisan must review applied content. Quantities and prices remain missing unless supplied. There are no section, discount, duplication, or Publication tools.

A turn has at most six model rounds and twelve tool calls. Tools execute sequentially. The total deadline is `QUOTE_AI_TIMEOUT_MS`, not a fresh allowance per round. Model retries are disabled. The current message is limited to 8,000 characters. History retains up to 24 whole messages and 24,000 characters, and explicitly reports omitted older context. Selected work contains at most 200 lines and 40,000 UTF-8 bytes. A larger draft remains manually editable rather than losing work from its context.

Each outgoing context and serialized provider payload is limited to 200,000 bytes. Each model response is limited to 64,000 bytes, with 256,000 bytes across the turn and a 4,096-token output allowance per round. The final visible reply is limited to 4,000 characters. Any provider or tool failure, invalid result, timeout, or exhausted budget discards staged changes. The server validates and calculates a successful result, checks its version, and commits it once with the conversation and one Undo target. Payload-bound request IDs prevent duplicate accepted changes. Manual saves remain available and cause stale assistant results to be rejected.

## Google terms checked for the fictional workflow

The following Google primary sources were checked on 2026-09-15:

- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) says unpaid Gemini API quota is an Unpaid Service. Google may use submitted content and generated responses to provide, improve, and develop products and machine-learning technologies. Human reviewers may read, annotate, and process API input and output. The terms say not to submit sensitive, confidential, or personal information to Unpaid Services.
- The same terms say API Clients made available to users in the European Economic Area, Switzerland, or the United Kingdom may use only Paid Services. For those regions, the Paid Services data-use terms apply even to Google AI Studio and unpaid Gemini API quota. A local test operator must check the applicable region and service status before running this workflow. Do not use the workflow merely because it is local or fictional.
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) marks the Free Tier as content used to improve Google's products and the Paid Tier as not used to improve Google's products. Pricing and terms can change.

The fictional workflow requires `QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE`. This is a record that a human checked the applicable terms and region for that run. It is not evidence of no training, no retention, or a production approval.

## Configuration contract

`app/entry.server.tsx` calls `assertQuoteAIConfiguration()` as its server module initializes, before it can handle requests. The synchronous check makes no network request. `configuredQuoteAI()` returns the selected `model`, a bound pi `streamFn`, and `timeoutMs`. The stream calls pi `models.streamSimple()` with the selected API key and provider environment pinned into the request, so an ambient process key or Agent option cannot select different credentials.

| Variable | Normal production value | Fictional workflow value |
| --- | --- | --- |
| `QUOTE_AI_ENABLED` | `true` only after approval | `true` |
| `QUOTE_AI_PROVIDER` | A registered provider, currently `google` | `google` |
| `QUOTE_AI_MODEL` | A model in that provider's pi catalog | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | Runtime secret, never browser-visible | Shell-only runtime secret |
| `QUOTE_AI_TIMEOUT_MS` | Integer `1000` through `45000`, default `20000` | Same |
| `QUOTE_AI_NO_TRAINING_CONFIRMED` | Exactly `true` after verification | Exactly `false` |
| `QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE` | Non-empty recorded provider and data-processing review | Not used |
| `QUOTE_AI_FICTIONAL_TEST_MODE` | Absent or `false` | Exactly `true` |
| `QUOTE_AI_FICTIONAL_TEST_IDENTITIES` | Not used | Explicit `@example.test` addresses only |
| `QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE` | Not used | Non-empty human review reference |

When enabled in production, the server requires both `QUOTE_AI_NO_TRAINING_CONFIRMED=true` and `QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE`. The flag records an operator decision. It does not prove that the provider's plan, project, retention, training, regional terms, or data-processing terms were reviewed. The fictional mode rejects `NODE_ENV=production` and rejects that no-training flag.

There is no production provider approval or recorded real-data review now. Do not invent a review reference to turn this on. [#21](https://github.com/lbise/quote-app-proto/issues/21) owns configured-provider rehearsal and release acceptance. Neither fake-provider tests nor a fictional-data Gemini experiment satisfies that gate or approves real-data processing.

## Isolated fictional Google app test

This workflow starts a separate PostgreSQL container on `127.0.0.1:55433`, migrates a blank `easy_quote_fictional` database, creates one verified `fictional-artisan@example.test` account, then runs the app on `http://127.0.0.1:5175`. It allows no other sign-up address. It deletes the fictional database and volume when the server stops.

It deliberately replaces inherited database and auth settings. It does not read `GEMINI_API_KEY` from `.env`, import a normal database, or provide an import command. The script passes explicit loopback origins, an explicit fictional identity allowlist, and `QUOTE_AI_NO_TRAINING_CONFIRMED=false` to the app. The configuration check rejects a non-loopback database or origin, a wildcard or real-looking tester address, production mode, or a missing terms-review reference. The auth hooks apply the same fictional identity allowlist to direct registration and every protected server request, so a stale session or `.env` allowlist cannot onboard a real Artisan.

After checking the terms and region for the run, start it with shell variables, not a checked-in file:

```sh
GEMINI_API_KEY='...' \
QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE='LEGAL-TEST-001' \
npx tsx scripts/quote-ai-fictional.ts
```

Set `QUOTE_AI_MODEL` in the same shell command to test another model in the registered Google catalog. An unsupported value fails before the app starts. The workflow refuses a production `NODE_ENV`.

Sign in with the account printed by the script. Use only invented Artisan Business names, Customers, work, prices, and chat messages. Do not paste a real Quote, source document, contact detail, or conversation. Stop with Ctrl-C. The script removes its data.

## Production review required later

Before any real business or Customer data is processed, a human operator must:

1. Choose the provider and plan, then review the current provider, retention, regional, and data-processing terms.
2. Verify the actual no-training setting for the selected account or project and record the evidence in the deployment change.
3. Set the production gate and a meaningful `QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE` in the deployment secret store.
4. Update this document and the disclosure to name the actual provider and describe its reviewed processing terms.
5. Complete #21's configured-provider rehearsal and release acceptance.

Do not promise zero retention. A provider may retain content for safety, abuse prevention, legal obligations, or other documented purposes even when it does not use prompts to improve models.
