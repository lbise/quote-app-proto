# Gemini model selection

Checked 2026-09-15. This is a model choice for Easy Quote's development assistant. It does not approve Google or any other provider for real Artisan Business or Customer data.

## Recommendation

Use `gemini-3.5-flash-lite` instead of `gemini-2.5-flash` for the development assistant. It is a stable, registered model that matches this narrow job: short bilingual French or English chat, structured custom-tool calls, no web or live interaction, and an Artisan reviewing every change. Google calls it low-latency and cost-effective for high-volume agentic work and simple extraction. [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

Do not use an alias such as `gemini-flash-lite-latest`. A pinned ID makes a model change deliberate and testable.

## What was compared

All prices are Standard paid-tier USD per million tokens. "Free" means the pricing page lists a free tier, not that the service is suitable for real data or for an end-user app in every region.

| Model ID | Status and lifecycle | Context and supported capabilities | Price and fit |
| --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | GA 2026-07-21. No shutdown date announced. | 1,048,576 input and 65,536 output tokens. The model page lists function calling, structured outputs, and thinking as supported. | Free tier listed. $0.30 input, $2.50 output, $0.03 cached input. This is the recommendation. It is purpose-built for low-latency, cost-constrained extraction and agentic work. [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations) |
| `gemini-3.8-flash` | GA 2026-09-02. No shutdown date announced. It is very new, though it is stable rather than preview. | The same 1,048,576 and 65,536 token limits; function calling and structured outputs supported. Thinking has low, medium, and high levels. | Free tier listed. $0.75 input and $3.75 output through 2026-12-31, then $1.50 and $7.50. Use as the quality upgrade, not as the default. [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [release notes](https://ai.google.dev/gemini-api/docs/changelog), [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations) |
| `gemini-3.1-pro-preview` | Preview, released 2026-02-19. No shutdown date announced, but preview is the wrong stability trade for the default. | The same 1,048,576 and 65,536 token limits, and supports function calling, structured outputs, and thinking. | No free tier. $2.00 input and $12.00 output for prompts at or below 200k tokens. Its stronger multi-step tool use does not justify the cost or preview risk for initial capture. [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations) |
| Current `gemini-2.5-flash` | Stable since 2025-06-17. No shutdown date announced. | The same 1,048,576 and 65,536 limits and the same required function, structured-output, and thinking support. | Free tier listed. $0.30 input and $2.50 output. It has no announced retirement, but it is a much older generation at the same Standard price as 3.5 Flash-Lite. [Model](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations) |

The installed `@earendil-works/pi-ai` 0.85.1 Google catalog registers all four exact IDs with the Gemini Developer API, 1,048,576-token context, 65,536 maximum output, and reasoning enabled. It also records $0.30/$2.50 for 3.5 Flash-Lite and 2.5 Flash, $0.75/$3.75 for 3.8 Flash, and $2/$12 for 3.1 Pro Preview. [Local catalog](../../node_modules/@earendil-works/pi-ai/dist/providers/data/google.json)

## Why this fits Easy Quote

- The initial-capture workflow needs custom function calls. Google lists function calling for the recommended model. It also lists structured outputs. Google distinguishes tool actions during a conversation from JSON-format final answers, so the current tool loop should remain the primary mutation boundary. [Function calling](https://ai.google.dev/gemini-api/docs/function-calling), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- JSON Schema output is useful for a future non-mutating extraction step, but not a substitute for server validation. Google supports only a JSON Schema subset and explicitly says syntactically valid JSON still needs application validation. Easy Quote's server-owned tools and validation remain necessary. [Structured-output limits](https://ai.google.dev/gemini-api/docs/structured-output)
- The backend sends text, limits each turn to a 200,000-byte payload and a 4,096-token response, and sets thinking off. A one-million-token model context is therefore ample. The recommendation does not claim a tested French advantage. Google’s model pages do not make a French commercial-quote quality claim, and the current fictional tests provide no such benchmark.
- No live call is needed. `gemini-3.5-flash-lite` does not support the Live API, and its model page separately lists search grounding and Maps grounding as optional capabilities. Do not add either: the task is capture from the Artisan's message, not retrieval.

## Upgrade and fallback path

1. Start fictional French and English evaluation with the pinned default `gemini-3.5-flash-lite`. Include invented vague work descriptions, missing quantities or prices, corrections, French number formats, and attempted unsupported mutations. Measure invalid tool calls, clarification quality, staged-change rejection, latency, and tokens. Do not send real Quotes or identities.
2. If the lighter model repeatedly mishandles ambiguity or tool selection after prompt and server-boundary fixes, run the same fictional suite against pinned `gemini-3.8-flash`. It is the quality fallback. Its paid Standard price is 2.5 times higher for input and 1.5 times higher for output through 2026, and its January 2027 price increase is published, so make the change only on measured benefit.
3. Do not make `gemini-3.1-pro-preview` the automatic fallback. Escalate to it only for a separately measured, difficult non-live task, and reassess when a stable Pro is available. Do not use preview aliases or `*-latest` IDs as failover.
4. Recheck Google's release notes, pricing, deprecations, and the installed pi catalog before any change. Google describes published shutdown dates as the earliest possible retirement date and says it will give advance notice. `gemini-3.1-flash-lite`, for example, already has a 2027-05-07 date and a 3.5 Flash-Lite replacement, which is a good reason not to choose it now. [Lifecycle policy and table](https://ai.google.dev/gemini-api/docs/deprecations)

## Terms and production boundary

The free tier does not reopen the production question. Google's terms say unpaid Gemini API quota is an Unpaid Service: Google may use submitted content and responses to improve products, and human reviewers may process them. They also say an API client made available to users in the EEA, Switzerland, or UK may use only Paid Services. Paid Gemini API access requires a Cloud project with active billing; Google says it does not use paid prompts or responses to improve products, but logs them for a limited period for safety, security, and legal obligations. [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)

Easy Quote now configures the assistant in every environment so the development team can use it directly. That does not approve Google or the selected plan for real Artisan Business or Customer data. Review the provider, plan, region, retention and data-processing terms before sending real data. This research changed no application configuration or `.env` file.
