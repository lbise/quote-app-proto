# Hosted Quote AI

`app/lib/quote-assistant.server.ts` uses OpenAI's Chat Completions API with strict JSON Schema output. It is off until an operator enables it. There is no live tester data in the configured local environment now.

## Tester disclosure

Show this text before an Artisan first uses hosted AI:

> Easy Quote sends the message you submit, the conversation needed to answer it, and the Quote's work title, sections, lines, and discount to OpenAI for this request. It does not send the dedicated Customer or Artisan Business names, addresses, contact details, VAT identifier, Quote reference, dates, work-site address, or terms. A message or work description can still contain personal or commercial information that you type. OpenAI processes API content under its API data policy. Easy Quote does not write raw conversation text to its application logs. Review an applied change, undo it if needed, and review the Quote before Publication. The assistant cannot publish, send, or accept a Quote.

The application keeps original Quote data locally. It merges only the AI response's title, Quote Sections, Quote Lines, and whole-Quote Discount into the current Quote. It never takes Customer or Artisan Business data from an AI response. The server must validate the merged Working Draft, detect stale versions, and enforce idempotency before it saves anything. `reviewPublication` may open the Artisan's review. It never completes Publication.

The assistant may make a wrong inference despite the prompt. The Artisan remains responsible for quantities, prices, technical content, and approval.

## OpenAI policy check

These OpenAI primary sources were checked on 2026-09-13:

- [Your data](https://platform.openai.com/docs/guides/your-data) says API data is not used to train or improve OpenAI models unless the customer explicitly opts in. It also says abuse-monitoring logs can contain prompts and responses and are retained for up to 30 days by default. This is why the app sends only the fields needed for a request and does not promise zero retention.
- [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs) documents JSON Schema output for Chat Completions. Its supported-schema section lists `minLength`, `maxLength`, and `maxItems` for general models. Fine-tuned models have tighter limits, so the adapter rejects `OPENAI_MODEL` values beginning with `ft:`. The adapter still validates the returned data at runtime. A schema shapes a response. It does not prove commercial facts.

Do not enable this integration based only on this note. Before any live tester data is sent, the operator must revisit the first source, confirm that the API organization has not opted in to input/output sharing for training, and record the review in the deployment change. OpenAI's documentation describes default abuse-monitoring retention. Do not claim Zero Data Retention or Modified Abuse Monitoring unless OpenAI has approved and configured it for the organization or project.

## Configuration

Set every required value in the deployment secret store. Do not commit `OPENAI_API_KEY`.

| Variable | Required value | Purpose |
| --- | --- | --- |
| `QUOTE_AI_ENABLED` | `true` | Enables outbound OpenAI requests. Any other value disables the adapter. |
| `QUOTE_AI_NO_TRAINING_CONFIRMED` | `true` | Records the operator's explicit verification that the OpenAI API organization has not opted into training on submitted content. |
| `OPENAI_API_KEY` | Non-empty OpenAI API key | Authenticates requests. |
| `OPENAI_MODEL` | A non-empty general OpenAI model name that supports Chat Completions Structured Outputs. Do not use a value beginning with `ft:`. | Selects the model. Review its current OpenAI documentation before deployment. |
| `QUOTE_AI_TIMEOUT_MS` | Optional integer from `1000` through `45000`, default `20000` | Limits one provider request. |

The adapter fails closed if either enablement flag is absent, if the confirmation is not exactly `true`, or if the API key or model is missing. It makes no provider request in those cases.

## Data and logging rules

The request has a hard size limit. It sends the newest whole stored messages that fit within 24 messages and 24,000 characters in the current interface language, plus an 8,000-character current message, 50 Quote Sections, 200 Quote Lines, and 40,000 characters of selected Quote work data. It omits older context rather than rejecting a normal growing conversation, marks that omission in the provider request, and tells the model to clarify rather than guess when omitted context matters. The outbound body may not exceed 200,000 bytes and the provider response may not exceed 256,000 bytes. It excludes unrelated records and the dedicated contact and identity fields listed in the disclosure.

Do not add `console` logging, request-body logging, error reporting breadcrumbs, or traces that include raw conversations, Quote descriptions, or OpenAI responses. Provider errors returned by the adapter are generic for the same reason.

Use a fake `QuoteAIProvider` for authenticated backend-request tests. Routine tests must not call OpenAI.
