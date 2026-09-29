# Quote workspace

Issue #7 implements the desk workflow approved in #8, layout B v0.4 at `84874fb`. Open **My Quotes** from the authenticated home page, or visit `/quotes`.

## Design reference

The production workspace retains layout B's visual system, the 176px section rail, the 52px collapsed rail, the 16px gap and the 58/42 Quote/conversation split. The rail shrinks to 140px at intermediate widths. The assistant can be hidden to give the document more room, then reopened from the document toolbar. This preference is stored on the current browser when storage is available. Hiding the assistant keeps its conversation and unsent message mounted; it does not make unsent text survive a reload.

Below 1000px, Conversation/Quote controls and a section selector replace the desktop arrangement. Both panels scroll within the viewport so switching, section navigation and the Quote total remain accessible on phones. The desktop assistant preference does not hide the mobile Conversation panel. Editable draft details have persistent muted pencil icons and specific accessible names; the whole detail group is clickable. Published details remain read-only. Each line keeps an icon-only Edit action beside its amount on desktop and beside its pricing details on phones. Duplication, movement and deletion stay in the adjacent keyboard-accessible menu. Each section heading has one Add line action. Add section appears once after the work; inserting a section directly below another lives in that section's menu. The document-level Add menu also provides ungrouped lines and section creation on desktop and mobile. Editor forms scroll independently of their Cancel/Apply footer.

The prototype notice, scenario controls, layout switcher, scripted assistant and demonstration data are not part of the production route. Removing the notice and switcher gives the panels more vertical space. Customer/default-record management and hosted-AI disclosure use the same dialog components as the approved editors.

The design source remains under `app/components/quote-prototype/` for comparison. Its route is development-only. Production Quote modules do not import its fixtures, calculations or simulation.

## Supplementary interaction review

[Interaction review v1](quote-interaction-review-v1.md) records the current implementation and supplementary decisions for #9, including Customer search/replacement, edit scope, assistant explanations, section movement, undo/focus and bilingual copy. The user [approved these design decisions](https://github.com/lbise/quote-app-proto/issues/9#issuecomment-5669015864). Approval does not mean the proposed changes are implemented or extend #8's layout approval.

## Responsibilities

- `app/lib/quote.ts` validates and calculates complete or incomplete Quotes. Integer CHF cents and scaled `bigint` intermediates implement half-up rounding. Missing values are separate from invalid inputs. Published content uses the same calculation boundary as manual and assistant changes.
- `app/lib/quotes.server.ts` handles authenticated requests for Quotes, reusable Customers and business defaults. The Artisan Business comes from the approved session. Request keys, optimistic versions and database locks protect publication and retry behavior.
- `app/lib/quote-assistant.server.ts` runs pi's bounded model/tool loop with the complete current Working Draft, authoritative calculation and bounded recent history supplied before the first model call. `app/lib/quote-tools.server.ts` stages the approved commercial tools (`edit_quote_details`, `edit_quote_lines`) and structural tools (`edit_quote_sections`, `copy_quote_work`, `move_quote_work`, `delete_quote_lines`), with Quote-local Customer and business fields. It never exposes reusable records or needs a `read_work` call. Structural operations use stable IDs, preserve unrelated order and validate complete batches before staging. The model may supply derived quantities or adjusted prices. The application validates formats, modes, bounds and calculations, but not their source, formula, or arithmetic. It remains authoritative for calculated amounts. The first two failed tool calls may leave successful staged work for a normal one-turn commit; the third discards the turn. Manual-only destructive scope is rejected as a whole-turn abort. The assistant has no Publication or Undo authority. See [hosted AI configuration](quote-ai.md).
- `app/components/quotes/use-quote.ts` queues saves, retains failed local edits and coordinates visible assistant status. The document, dialogs and section controls use the approved layout.

`GET /api/quotes` lists the authenticated business's Quotes, Customers and defaults. `GET /api/quotes?id=…` reads a Working Draft and its Published Revisions and conversation. `POST /api/quotes` accepts the explicit `create`, `create-from`, `save`, `undo`, `assistant`, `publish`, `new-draft`, `archive`, `restore`, `delete`, `customer-save`, `customer-apply` and `defaults-save` operations. `customer-apply` verifies the selected Customer belongs to the authenticated Artisan Business, then copies its saved name, address and optional contact into the Working Draft as one undoable Quote snapshot change.

Publication freezes commercial content and calculated amounts together. It removes the Working Draft, assigns the next revision number and does not send anything. New revision drafts copy the latest publication's dates, identity snapshots, terms and tax settings unchanged. Editing reusable records never refreshes existing Quotes. Section-editor changes apply as one undoable action when the Artisan chooses Done.

## Archive and delete

See [ADR 0006](adr/0006-artisans-may-delete-any-quote.md). `archive` and `restore` take a Quote ID and a request key, not an expected version. They never change the Working Draft, Published Revisions or version. An Archived Quote refuses `save`, `undo`, `publish`, `new-draft`, `customer-apply` and `assistant` with `409 quote_archived`. Archiving ends a pending assistant turn with a conversation note, and its response is discarded when it arrives, even if the Quote was restored in the meantime. Quote Documents and Draft Previews still download.

The Quote page shows an Archived Quote read-only with a Restore banner: its latest Published Revision, or its Working Draft if it was never published. A Working Draft on top of a Published Revision is kept as it was and comes back on restore. The list has Active and Archived tabs, and search covers only the tab shown. Each row's actions menu and the Quote page header menu offer Archive or Restore, and Delete.

`delete` permanently removes the Quote. Foreign keys remove its Published Revisions, conversation, request records and Turn Traces. The delete request is kept without a Quote ID, so a retried key succeeds. The browser asks first in an `AlertDialog` with Cancel focused.

Automatic references come from `artisan_business.next_quote_number`, which only goes up, so a deleted Quote's number is never assigned again. A number an Artisan already typed into another Quote is skipped. Easy Quote does not remember deleted references, so an Artisan may type one again by hand.

`app/lib/quote-archive.server.test.ts` covers this through authenticated PostgreSQL requests. `tests/browser/quote-archive.spec.ts` covers the list tabs, menus, confirmation and the read-only Archived Quote in English and French.

## Start a Quote from another

An Artisan can start a new Quote from one version of an existing Quote: its Working Draft or one of its Published Revisions. `create-from` takes the source Quote ID, `from` (`"draft"` or a revision number) and a request key. The Artisan always chooses the version; the server never picks one.

The new Quote gets the next automatic reference and a Working Draft. Only the title and the Quote Sections and Quote Lines are copied, in order, with new IDs and prices as they are. Everything else is what `create` gives a new Quote: empty Customer and site address, current business defaults (details, VAT, terms, logo), no Quote Discount and blank dates. It has no conversation, no Undo and no captured line IDs, so copied lines count as the Artisan's. The Quote Layout is chosen at Publication as usual. The new Quote stores no link to its source, and the source (draft, revisions, archived state, version) is not changed.

Any Quote the Artisan can open can be a source, including Archived and never-published Quotes, and a version with no lines. The Working Draft is copied as stored: unsaved edits in other tabs and pending assistant changes are not included. With `expectedVersion`, the copy fails with `409 stale_version` unless the stored Working Draft is still that version. A retried key returns the same new Quote.

In the workspace, the toolbar's **More Quote actions** menu has "New Quote from the Working Draft" or "New Quote from Revision <n>", naming the version on screen. It copies at once, and is disabled while the draft is saving, has unsaved or failed changes, or has an assistant change in progress. It sends `expectedVersion` when copying the Working Draft. In the Quotes list, each row's actions menu (archived rows included) has "New Quote from…". A Quote with one version is copied at once. With several, a dialog lists the Working Draft first, then revisions newest first, each with its date, total and line count. Nothing is preselected, and Create Quote stays disabled until a version is chosen.

The new Quote's workspace opens with the notice "Started from <reference>, <version>", carried in navigation state. There is no confirmation step and no Undo; an unwanted copy is deleted from the list.

`app/lib/quote-start-from.ts` holds what is copied and how versions are named and listed. `app/lib/quote-start-from.server.test.ts` covers the request through authenticated PostgreSQL requests. `tests/browser/quote-start-from.spec.ts` covers the workspace menu, its disabled states, the list dialog and an Archived source in English and French.

## PDFs

[Quote PDFs](quote-pdf.md) is the specification. `app/lib/quote-document.ts` turns a Published Revision (with its stored amounts) or a Working Draft into what a Quote Layout shows. `app/lib/quote-layouts/` holds every Quote Layout version. Never change an existing version's appearance (ADR 0004). `app/lib/pdf-renderer.server.ts` prints a layout's self-contained HTML with headless Chromium, with no JavaScript or network access (ADR 0005). `app/lib/quote-pdf.server.ts` serves `GET /api/quotes/:id/revisions/:number/document` and `GET /api/quotes/:id/draft-preview`. PDFs are rendered on each download and never stored.

`app/lib/business-logo.server.ts` serves `POST /api/business-logo`, which accepts PNG or JPEG up to 1 MB, identified by file signature, and `GET /api/business-logo/:id`. Logos are immutable rows. A new Working Draft copies the business default `logoId` with the other business details, and Publication freezes it in the revision. Downloads only load logos that belong to the Quote's business.

Local edits do not survive a browser crash or closure unless the server accepted them. The browser warns before leaving with unsaved work where supported. A conflict with another window retains local edits for inspection; it does not silently overwrite the newer server version.

## Business defaults and copied details

Use **Settings** (`/settings`) to save reusable business name, address, contact details and logo (Business), VAT settings (VAT) and default terms (Quote defaults). These defaults apply only when creating a new Quote. The Account section shows the signed-in email, switches the interface language and signs out. Reusable Customer records live on their own **Customers** page (`/customers`); choose one for a Quote from the Quote's Customer block. Use **Details & terms** to edit an existing Working Draft's copy, including a draft created before defaults were available. Those edits autosave and use Quote Undo. Saving defaults does neither.

VAT registration has three states: To confirm, Yes and No. Saving registered defaults requires a nonblank VAT identifier. Artisans can save incomplete business details and leave registration at To confirm. Business setup never blocks starting a Quote. A Working Draft may also retain registered status with a missing identifier. Its editor explains that it is incomplete, and Publication still requires the missing details. Registered Quotes support only current standard-rate work. This flow does not change the existing calculation rules.

Save defaults reports success only after the server accepts the request. A load failure disables the forms and offers Retry. A save failure keeps the entries and offers Retry without refreshing any Quote. Each Settings section saves on its own. Leaving a section or the page with unsaved edits asks whether to discard them, with Keep editing focused first. The Customers page asks the same before switching records or leaving with unsaved record edits.

The business logo uploads and is removed at once, separately from Save defaults. It appears on the PDFs of new Quotes. **Restore from business settings** in a Working Draft copies the current logo too.

`app/lib/business-defaults.server.test.ts` covers this behavior through authenticated PostgreSQL requests. `tests/browser/business-defaults.spec.ts` covers copy scope, quote-local edits and Undo, load/save retries, discard confirmation and English/French keyboard validation. French terms remain commercial content when the interface language changes.

## Run and test

Apply migrations to the configured local PostgreSQL database, then start the app:

```sh
npm run db:migrate
npm run dev
```

Focused tests:

```sh
npx vitest run app/lib/quote.test.ts app/lib/quote-tools.server.test.ts app/lib/quote-assistant.server.test.ts
npx vitest run app/lib/quotes-ai.server.test.ts
npx vitest run app/lib/quote-pdf.server.test.ts app/lib/business-logo.server.test.ts
npx vitest run app/lib/quote-pricing.server.test.ts app/lib/quote-publication.server.test.ts app/lib/quote-revisions.server.test.ts
npm run test:browser
```

`quote-pricing`, `quote-publication` and `quote-revisions` cover the whole-Quote Discount and VAT rules (#15), first Publication (#18) and later revisions (#19) through authenticated requests and reloads. They share the sign-in harness in `app/lib/quote-http.test-support.ts`. The browser specs with the same names cover those workflows in English and French.

`quote-tools.server.test.ts` covers the registered commercial and structural tools, bounded section editing, copying, ordering, targeted deletion, unknown-measurement cleanup, fresh IDs and all-work guards. `quote-assistant.server.test.ts` covers the full-draft model context, structural moves/deletion, mixed-turn rollback, failed-call status and response limits. `quotes-ai.server.test.ts` exercises the authenticated PostgreSQL path for persistence, structural totals, whole-turn Undo, reference locking, retries and third-failure rollback. The browser assistant specs use intercepted responses for deterministic UI behavior, not live model calls. They cover disclosure, change visibility, stale/retry behavior and manual Undo; they do not replace authenticated executor coverage.

Browser tests use an isolated database whose name ends in `_browser`, unless `BROWSER_TEST_DATABASE_URL` is supplied. The setup creates that database and applies migrations. Its PostgreSQL role needs permission to create a database. Browser authentication goes through Better Auth; only test-user email verification uses direct fixture setup. Never point these tests at production. Browser traces contain authenticated test traffic and should not be published without review.

The default browser suite uses Chromium on port 5180. Install it with `npx playwright install chromium`. The PDF server tests need the same Chromium. PostgreSQL-backed server tests are skipped unless `TEST_DATABASE_URL` is set, in the shell or in `.env`. It must name a separate test database, never the `DATABASE_URL` one: tests create Users and Quotes they never delete, and the test setup refuses to run against the development database. Each Vitest run applies pending migrations to it before the tests start. A passing run with skips does not verify persistence. CI runs the database-backed tests and the browser suite.

Routine request tests use a controllable pi model boundary and the real tool executor. Browser tests use network interception for deterministic assistant replies. Neither makes live model calls. Fictional Google app experiments require the isolated workflow in [quote-ai.md](quote-ai.md). Real-data rehearsal remains gated on recorded provider review and the release acceptance in #21. No provider credentials reach the browser.

## Migration and rollback

`0002_quotes.sql` adds Quote, revision, conversation, request, Customer and defaults storage. `0003_quote_request_leases.sql` adds request payload hashes and AI lease expiry. `0004_quote_capture_provenance.sql` stores server-owned initial-capture and undo eligibility and gives conversation messages a stable ordering sequence. `0005_quote_revision_layout.sql` records each Published Revision's Quote Layout; existing revisions get standard version 1. `0006_business_logo.sql` adds immutable business logos. `0010_quote_archive.sql` adds `quote.archived_at` and each business's `next_quote_number`, starting after its highest current `Q-<n>`. These migrations are additive and leave authentication tables unchanged.

Take a database backup before deployment. The previous application can run against the expanded schema, but cannot expose the new Quote workflow. Before `0010`, it would also list Archived Quotes as active and could give a deleted Quote's number to a new Quote. Roll back the application image without dropping the new tables or columns. Preserve them so drafts and publications remain available after rolling forward. A database restore is a separate recovery operation and can lose changes made after the backup.

AI processing uses a bounded lease. If a server stops during a request, a later authenticated request expires the lease without applying the abandoned response. The Artisan can retry. Publication stays blocked while an unexpired AI change is pending.
