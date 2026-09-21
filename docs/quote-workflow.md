# Quote workspace

Issue #7 implements the desk workflow approved in #8, layout B v0.4 at `84874fb`. Open **My Quotes** from the authenticated home page, or visit `/quotes`.

## Design reference

The production workspace copies layout B's styles, font files, spacing and document markup. It keeps the 176px section rail, the 52px collapsed rail, the 16px gap and the 58/42 Quote/conversation split. The rail shrinks to 140px at intermediate widths. Below 1000px, panel buttons and a section selector replace the desktop arrangement. Below 600px, the document uses page scrolling and the transcript has a bounded height.

The prototype notice, scenario controls, layout switcher, scripted assistant and demonstration data are not part of the production route. Removing the notice and switcher gives the panels more vertical space. Customer/default-record management and hosted-AI disclosure use the same dialog components as the approved editors.

The design source remains under `app/components/quote-prototype/` for comparison. Its route is development-only. Production Quote modules do not import its fixtures, calculations or simulation.

## Supplementary interaction review

[Interaction review v1](quote-interaction-review-v1.md) records the current implementation and supplementary decisions for #9, including Customer search/replacement, edit scope, assistant explanations, section movement, undo/focus and bilingual copy. The user [approved these design decisions](https://github.com/lbise/quote-app-proto/issues/9#issuecomment-5669015864). Approval does not mean the proposed changes are implemented or extend #8's layout approval.

## Responsibilities

- `app/lib/quote.ts` validates and calculates complete or incomplete Quotes. Integer CHF cents and scaled `bigint` intermediates implement half-up rounding. Missing values are separate from invalid inputs. Published content uses the same calculation boundary as manual and assistant changes.
- `app/lib/quotes.server.ts` handles authenticated requests for Quotes, reusable Customers and business defaults. The Artisan Business comes from the approved session. Request keys, optimistic versions and database locks protect publication and retry behavior.
- `app/lib/quote-assistant.server.ts` runs pi's bounded model/tool loop with the complete current Working Draft, authoritative calculation and bounded recent history supplied before the first model call. `app/lib/quote-tools.server.ts` stages flat initial capture, Quote-local Customer details, and missing-field clarification; it never exposes reusable Customer records or needs a `read_work` call. The server commits a successful turn as one undoable action, while the first two failed tool calls remain recoverable and the third discards the turn. The assistant has no Publication or Undo authority. See [hosted AI configuration](quote-ai.md).
- `app/components/quotes/use-quote.ts` queues saves, retains failed local edits and coordinates visible assistant status. The document, dialogs and section controls use the approved layout.

`GET /api/quotes` lists the authenticated business's Quotes, Customers and defaults. `GET /api/quotes?id=…` reads a Working Draft and its Published Revisions and conversation. `POST /api/quotes` accepts the explicit `create`, `save`, `undo`, `assistant`, `publish`, `new-draft`, `customer-save`, `customer-apply` and `defaults-save` operations. `customer-apply` verifies the selected Customer belongs to the authenticated Artisan Business, then copies its saved name, address and optional contact into the Working Draft as one undoable Quote snapshot change.

Publication freezes commercial content and calculated amounts together. It removes the Working Draft, assigns the next revision number and does not send anything. New revision drafts copy the latest publication's dates, identity snapshots, terms and tax settings unchanged. Editing reusable records never refreshes existing Quotes. Section-editor changes apply as one undoable action when the Artisan chooses Done.

Local edits do not survive a browser crash or closure unless the server accepted them. The browser warns before leaving with unsaved work where supported. A conflict with another window retains local edits for inspection; it does not silently overwrite the newer server version.

## Business defaults and copied details

Use **Customers & business** to save reusable business name, address, contact details, terms and VAT settings. These defaults apply only when creating a new Quote. Use **Details & terms** to edit an existing Working Draft's copy, including a draft created before defaults were available. Those edits autosave and use Quote Undo. Saving defaults does neither.

VAT registration has three states: To confirm, Yes and No. Saving registered defaults requires a nonblank VAT identifier. Artisans can save incomplete business details and leave registration at To confirm. Business setup never blocks starting a Quote. A Working Draft may also retain registered status with a missing identifier. Its editor explains that it is incomplete, and Publication still requires the missing details. Registered Quotes support only current standard-rate work. This flow does not change the existing calculation rules.

Save defaults reports success only after the server accepts the request. A load failure disables the forms and offers Retry. A save failure keeps the entries and offers Retry without refreshing any Quote. Saving a Customer does not reset pending default edits. Closing with unsaved default edits asks whether to discard them, with Keep editing focused first.

`app/lib/business-defaults.server.test.ts` covers this behavior through authenticated PostgreSQL requests. `tests/browser/business-defaults.spec.ts` covers copy scope, quote-local edits and Undo, load/save retries, discard confirmation and English/French keyboard validation. French terms remain commercial content when the interface language changes.

## Run and test

Apply migrations to the configured local PostgreSQL database, then start the app:

```sh
npm run db:migrate
npm run dev
```

Focused tests:

```sh
npx vitest run app/lib/quote.test.ts
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run app/lib/quotes.server.test.ts
npm run test:browser
```

Browser tests use an isolated database whose name ends in `_browser`, unless `BROWSER_TEST_DATABASE_URL` is supplied. The setup creates that database and applies migrations. Its PostgreSQL role needs permission to create a database. Browser authentication goes through Better Auth; only test-user email verification uses direct fixture setup. Never point these tests at production. Browser traces contain authenticated test traffic and should not be published without review.

The default browser suite uses Chromium on port 5180. Install it with `npx playwright install chromium`. PostgreSQL-backed server tests are skipped unless `TEST_DATABASE_URL` is set. A passing run with skips does not verify persistence. CI runs the database-backed tests and the browser suite.

Routine request tests use a controllable pi model boundary and the real tool executor. Browser tests use network interception for deterministic assistant replies. Neither makes live model calls. Fictional Google app experiments require the isolated workflow in [quote-ai.md](quote-ai.md). Real-data rehearsal remains gated on recorded provider review and the release acceptance in #21. No provider credentials reach the browser.

## Migration and rollback

`0002_quotes.sql` adds Quote, revision, conversation, request, Customer and defaults storage. `0003_quote_request_leases.sql` adds request payload hashes and AI lease expiry. `0004_quote_capture_provenance.sql` stores server-owned initial-capture and undo eligibility and gives conversation messages a stable ordering sequence. These migrations are additive and leave authentication tables unchanged.

Take a database backup before deployment. The previous application can run against the expanded schema, but cannot expose the new Quote workflow. Roll back the application image without dropping the new tables or columns. Preserve them so drafts and publications remain available after rolling forward. A database restore is a separate recovery operation and can lose changes made after the backup.

AI processing uses a bounded lease. If a server stops during a request, a later authenticated request expires the lease without applying the abandoned response. The Artisan can retry. Publication stays blocked while an unexpired AI change is pending.
