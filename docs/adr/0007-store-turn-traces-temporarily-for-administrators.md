# Store Turn Traces temporarily for Administrators

Administrators must be able to open a past Assistant Turn and see exactly what the model received and returned, for debugging and for problem reports (#45). The provider request is assembled at runtime and cannot be rebuilt faithfully later, because history selection and generated context depend on the moment the turn ran. Easy Quote therefore stores a Turn Trace for every Assistant Turn, including failed and discarded ones. It contains the exact provider payload of each model call (system prompt, tool definitions, messages, context), the raw provider response, tool results and rejections, the outcome, the model, token usage, cost and timing. Credentials are never stored, and speech-to-text requests are not traced.

This reverses the earlier rule in `docs/quote-ai.md` against keeping raw payloads and provider responses. Turn Traces are kept in the database, never in application logs, traces or error reports. Only Administrators can read them. A Turn Trace is deleted after 30 days or when its Quote is deleted, whichever comes first, so that an Artisan who deletes a Quote still removes its AI records (ADR 0006). Artisans are told in the app that Administrators can read their Quotes and conversations.

## Considered options

- **Rebuild the request from stored messages and the Working Draft.** No new data is kept, but the result is lossy, and a debugging tool that can be wrong is worse than none.
- **Trace only when a switch is on.** Less data would be kept, but the turn someone reports has usually already happened.
- **Keep Turn Traces after their Quote is deleted.** Problem reports would keep working, but the Artisan's data would outlive their deletion.
