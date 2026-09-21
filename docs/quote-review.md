# Implementation review and rehearsal

Historical review record: the first two-axis review used `84874fb` as its base and reviewed implementation commit `fd6bcc7`. The changes after that review addressed the findings below; its 50-section/200-line wording is historical, not the current assistant limit. The original approved design remains layout B v0.4.

## Standards

The first pass reported three documentation concerns and two possible code smells.

- Expanded the first-use AI disclosure to name the included and excluded fields, link OpenAI's API data policy, and explain autosaving, undo and the assistant's lack of publication, sending or acceptance authority.
- Clarified that the 50-section and 200-line limits apply to the complete draft sent to the assistant. They do not authorize silently dropping work. Larger drafts remain manually editable. The review's proposed subset selection would have broken the complete-snapshot change contract.
- Clarified the deployment documentation. Local health tests can use injected adapters; the approved authenticated Quote boundary requires real PostgreSQL. Skipping those tests without `TEST_DATABASE_URL` is deliberate, not a reason to replace them with database mocks.
- Renamed the assistant-message constructor, which had been called `note` despite creating assistant messages.
- Shared the bounded streamed-body reader between authenticated requests and provider responses.

Removed unused calculation wrappers and their direct helper assertions. Detailed arithmetic tests now observe the whole-Quote calculation boundary.

## Spec

The first pass reported one high-priority correctness issue, three other implementation issues and one validation gap. It found no scope creep.

- Published displays now use the stored revision calculation for line amounts, section subtotals, VAT and totals. A browser regression supplies a historical stored calculation that differs from current arithmetic and verifies the stored amounts appear.
- An unchanged manual save no longer consumes the previous draft-changing action's undo target or advances its version. The authenticated request suite covers save, no-op save and undo.
- Assistant changes to titles, discounts and sections now carry derived change metadata, persist in the conversation, display markers and offer navigation to the changed content.
- Customer creation now uses payload-bound retry keys. Both authenticated-request and browser tests cover a successful creation whose response is lost, followed by retry without another Customer.
- The implementation rehearsal is recorded below. The Artisan's timed comparison and a configured hosted-model rehearsal remain human validation work. This change does not claim the preparation-time hypothesis is proven.

## Desk rehearsal

Used an isolated local database and authenticated Better Auth sessions. No source PDF or original personal information was transmitted to a hosted provider.

The browser suite covers creation, manual editing, save/reopen, publication through revision 2, older read-only inspection, reusable-Customer isolation, failed-save correction and retry, privacy disclosure, and visible assistant failure/stale-response recovery. Assistant responses are controlled in recovery tests; these tests are not a live-model evaluation.

An additional agent-browser walkthrough used the [source-adapted joinery fixture](examples/first-quotes/joinery-reference.md):

1. Opened its 30 lines and seven sections. Displayed total was CHF 29'029.50.
2. Removed line 3's quantity. Pricing became partial and publication confirmation was disabled.
3. Restored the quantity, duplicated the first line and undid that duplication.
4. Published revision 1 at CHF 29'029.50.
5. Created a later Working Draft, changed the first fixed amount from CHF 1'200.00 to CHF 1'000.00, and published revision 2 at CHF 28'813.30.
6. Inspected revision 1 again. It retained CHF 29'029.50 and had no line-editing actions. Reload opened revision 2 read-only at CHF 28'813.30.

At 1440px, the workspace retains the approved 16px panel gap and 58/42 split. The collapsed rail measures 52px and its toggle retains focus. The browser screenshot baseline covers the full synthetic 30-line layout. Removing the prototype notice shifts the panels up by 36px; removing the layout switcher leaves more vertical space.

At 900px, the section rail is hidden, the Conversation/Quote buttons control the visible panel, and the document does not overflow the viewport horizontally.

An axe-core 4.12.1 check against WCAG 2 A/AA rules found no violations. The initial check could not measure an off-screen caption's contrast; scrolling it into view and rerunning produced no incomplete checks or violations. This automated check does not replace a screen-reader review.

## Final automated checks

- Typecheck passed.
- Vitest passed all 42 tests with real PostgreSQL enabled, with no skips.
- Chromium passed all 11 browser tests, including the screenshot comparison.
- Production build passed.
- Deployment-script validation passed. The local SSH signing agent was unavailable, so commit and tag signing were disabled only for that test process's temporary repositories.

The first review reported five findings per axis. Its most important Standards concern was disclosure completeness; its most important Spec concern was displaying frozen amounts. Both are addressed. The remaining human validation work is listed below.

## Before involving the Artisan

- Configure the hosted provider and verify its no-training settings using [the operator checklist](quote-ai.md). Test representative English/French instructions with that actual model, including ambiguous targets, copied measurements and multi-line corrections.
- Complete an assistive-technology review beyond automated axe checks.
- Measure full preparation and correction time against the Artisan's current process. Record factual mistakes, corrections and lost work as well as elapsed time. No Artisan benchmark was run during implementation.
