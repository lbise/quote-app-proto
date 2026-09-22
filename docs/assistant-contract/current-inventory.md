# Assistant contract baseline inventory

Status: historical migration record for [#26](https://github.com/lbise/quote-app-proto/issues/26). It is not a current model-facing contract and does not claim that its old calls remain registered.

## What this record preserves

The pre-replacement assistant used a limited initial message, retained conversation, and a `read_work` step to expose existing lines. It had separate small mutation tools for Customer details, line capture and correction, section changes, moves, and copies. It also used an automatic Publication-review heuristic. The replacement contract removes the `read_work` dependency, receives the complete current Working Draft before the first call, and keeps Publication manual.

Older tool definitions and tests may still contain legacy support metadata while the staged replacement is implemented. That metadata is not an instruction for replacement tools. Do not carry it into new schemas, prompts, examples, or model calls.

## Replacement boundary

The replacement assistant receives the complete Working Draft, authoritative calculation, bounded recent history, and current Artisan message. The complete draft can include Quote-local Customer and business details. The request boundary, not the model, selects the Artisan Business, Quote, version, provider, model, credential, and timeout.

Replacement tools accept direct commercial and structural arguments. The application validates object shape, target IDs, decimal form and range, pricing modes, batch bounds, whole-Quote validity, and calculations. It does not validate source provenance, natural-language interpretation, faithful translation, formula choice, or arithmetic behind a model-supplied quantity or adjusted price. Calculated line amounts and Quote totals remain application-owned. Human review is required before Publication.

## Disclosure and test implications

The full draft and bounded history may be sent to the provider. This is broader than the old work-only read. Provider terms and real-data approval remain separate. See [messages.md](messages.md) and [Quote AI](../quote-ai.md).

Migration tests must distinguish historical behavior from replacement behavior. Test the full first-call context, direct commercial arguments, structural batches, calculation, rollback after the third rejected call, manual Undo, stale edits, idempotency, ownership isolation, and no automatic Publication. Scripted browser responses test the UI only. They do not prove executor authority or model interpretation.

## Historical source locations

The baseline source coordinates were recorded against commit `f331f0ea36a2de9bfd434c6a96df46ecbe4bca8b`. Consult that commit when investigating a legacy behavior. Do not treat this inventory as a promise about the checked-out runtime while the replacement work is in progress.
