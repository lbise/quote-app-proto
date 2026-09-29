# Artisans may permanently delete any Quote, including published ones

Artisans need to clear abandoned and throwaway Quotes out of their list. Any Quote can be archived, which hides it from the active Quotes and can be undone. Any Quote can also be permanently deleted, including one with Published Revisions or one that is already archived. Deletion removes the Quote with its Published Revisions, conversation and AI request records. It cannot be undone, so the Artisan must confirm it first. This does not contradict [ADR 0003](0003-freeze-published-quote-revisions.md), which forbids undoing or overwriting a Publication but never promised to keep the Quote itself. The Artisan owns their business records and decides what to keep.

Automatically assigned references are never reused. A published Quote's reference may still appear on a PDF the Customer holds, and reusing it would make it point to a different Quote. Each Artisan Business has a counter that only increases, so deleting the newest Quote leaves a gap in the numbering. Deleting a never-published Quote also leaves a gap: sharing one rule for all Quotes costs less than keeping track of which deleted Quotes were published. Easy Quote does not remember deleted references, so an Artisan can still type an old reference into a new Quote by hand.

## Considered options

- **Archive only, never delete.** This keeps every record and needs no confirmation, but the Artisan could never really get rid of a Quote.
- **Delete only never-published Quotes, and archive published ones.** This follows most naturally from ADR 0003, but it adds a rule the Artisan has to learn and takes away control of their own records.
- **Reuse the numbers of deleted never-published Quotes.** No Customer ever saw those references, but it would mean remembering which deleted references were published.
