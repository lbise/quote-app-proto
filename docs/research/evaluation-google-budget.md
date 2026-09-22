# Gemini evaluation budget boundary

Checked 2026-09-22 UTC. This is a design note, not approval to send a scenario or make a provider call. No credential, authenticated endpoint, or Gemini generation was used for this research.

## Fixed facts

Use the stable, pinned ID `gemini-3.5-flash-lite`, not a `latest` alias. Google's model card lists a 1,048,576-token input limit, a 65,536-token output limit, text output, and thinking and function calling support. [Model card, source lines 2664-2800](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

The paid Standard rate is $0.30 input and $2.50 output per million tokens. The output rate explicitly includes thinking tokens. The same page currently also lists Priority at $0.54 input and $4.50 output, the highest text rates shown for this model. Google does not give these 3.5 Flash-Lite prices an end date. [Pricing, source lines 4211-4399](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite)

Thinking defaults to minimal and supports minimal, low, medium, and high. Google's thinking guide says `max_output_tokens` includes thought tokens and is a hard infrastructure cutoff. The GenerateContent reference calls `maxOutputTokens` the maximum tokens in a response candidate. This is the documented basis for using the 65,536 limit as a combined visible-output-plus-thinking bound. [Thinking, lines 3341-3522](https://ai.google.dev/gemini-api/docs/thinking#token-limits-and-max_output_tokens), [GenerateContent, lines 20045-20055](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig).

`UsageMetadata` reports prompt, cached-prompt, candidate, thought, tool-use-prompt, and total counts. Its documented total is prompt plus thoughts plus candidates. [GenerateContent, lines 12315-12420](https://ai.google.dev/api/generate-content#v1beta.UsageMetadata). Google says all Gemini 2.5-and-newer models have implicit caching enabled by default, pass savings through automatically, and report hits as `total_cached_tokens`. It documents no switch to turn implicit caching off. Explicit cache objects are separate. [Caching, lines 2104-2167](https://ai.google.dev/gemini-api/docs/caching#implicit-caching)

That makes a literal "caching off" requirement infeasible for this model. Do not create or reference an explicit cache, and price every input token at the non-cached rate. An implicit hit can only reduce the known token charge, so it does not weaken the bound. Do not use cached counts to release budget.

## What pi 0.85.1 does

The installed Google provider calls `generateContentStream` at the Developer API v1beta endpoint. It maps `options.maxTokens` to `config.maxOutputTokens`, maps an abort signal to `config.abortSignal`, and enables Gemini 3 thinking at a level. Its attempt usage is `promptTokenCount - cachedContentTokenCount` input and `candidatesTokenCount + thoughtsTokenCount` output. [Provider](../../node_modules/@earendil-works/pi-ai/dist/providers/google.js#L6-L13), [adapter](../../node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js#L37-L196), [adapter parameters](../../node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js#L275-L340). The catalog already contains the exact ID, limits, and Standard price. [Catalog](../../node_modules/@earendil-works/pi-ai/dist/providers/data/google.json)

This adapter accepts images as `inlineData`, creates custom function declarations from tools, and exposes an arbitrary `onPayload` hook. It does not itself add Google Search or batch calls. The budget boundary rejects non-text messages and tool results, built-in tools, cache references, and any non-streaming or batch path. The CLI exposes no payload hook. The adapter preserves the application's payload-size inspection callback, but rejects replacement or in-place mutation of the validated payload, including replacement of its abort signal. [Message/tool conversion](../../node_modules/@earendil-works/pi-ai/dist/api/google-shared.js#L87-L280).

Pi retries only the initial stream request. Its default is zero retries; a caller-supplied positive `maxRetries` makes fresh requests for 408, 409, 429, and 5xx errors. Google recommends retries for these transient errors. [Pi retry policy](../../node_modules/@earendil-works/pi-ai/dist/utils/provider-retry.js#L1-L94), [Google troubleshooting, lines 2091-2103](https://ai.google.dev/gemini-api/docs/troubleshooting#retry-strategy). The installed Google SDK also makes a single `fetch` when `retryOptions` is absent. Pi creates its client without that option. [Pi client setup](../../node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js#L258-L274), [SDK source](../../node_modules/@google/genai/dist/node/index.mjs#L13305-L13325). The implemented boundary sets `maxRetries: 0`.

Google's public pricing and error pages do not say whether a failed, timed-out, or client-aborted generation is billed, nor that partial stream usage is final billing. Abort stops the local request, not a documented billing guarantee.

## Recommendation

The implemented evaluation boundary keeps the production `maxOutputTokens` at 4,096, including thinking. It uses one streaming GenerateContent request, text-only request and tool-result parts, and app-owned custom function tools. It excludes Search, Maps, URL context, code execution, file search, computer use, media, explicit caching, batch, flex, and priority service selection. Each tool-loop generation is a separate call. The provider's 65,536 output limit remains a model-metadata check, not a requested output increase.

The reviewed price snapshot records `checkedAt: 2026-09-22 UTC`, `expiresAt: 2026-09-29 UTC`, input `540` nanoUSD per token, and output `4500` nanoUSD per token. Those are the highest published Priority rates used conservatively for Standard calls. Refuse a run after expiry until someone rereads the official pricing page and records a new snapshot. Google makes no price promise through that local expiry.

Before *each* submission, the boundary writes and fsyncs a durable append-only ledger record for that command. There is no resume. Calls and elapsed time are shared across every selected case and repetition. It rejects a request after the monotonic deadline or when either shared cap or remaining budget cannot cover one more reservation. It reserves the full input window and the configured 4,096 output tokens:

`1,048,576 * 540 + 4,096 * 4,500 = 584,663,040 nanoUSD = $0.58466304`.

This value was calculated with `Decimal`. For comparison only, using the 65,536 model maximum would reserve $0.86114304, not the earlier $0.861142. `countTokens` is unnecessary and would add another provider request: full-context reservation remains valid even when the prompt is smaller.

Reservations are never released, including after a complete cheaper response. The ledger records reported usage and its calculated cost separately for diagnosis. If terminal usage is absent, malformed, partial, the request errors, or it is aborted, the boundary retains the reservation, stops the command, and starts no later scenario or retry.

This enforces the caller's pre-request limits under the documented model limits and known rates. It is deliberately stricter than expected billing. It is not a promise that Google's eventual invoice will match local accounting, especially for failures or aborts. No live call or scenario approval was performed for this update.

## Source notes

All official citations above were retrieved from the public primary URLs on the checked date. Local line references are the installed `@earendil-works/pi-ai` 0.85.1 distribution and its installed `@google/genai` dependency.
