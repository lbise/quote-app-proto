# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope

This record primarily covers the main Easy Quote application under `app/`. The standalone developer evaluator under `eval/` has its own scoped context at the end of this file. Application domain terminology lives in `CONTEXT.md`; Publication rules live in `docs/adr/0003-freeze-published-quote-revisions.md`.

The existing `DESIGN.md` and `.impeccable/surfaces/eval-report-ts.md` apply only to the evaluator. They do not define the main application's design.

## Users

Easy Quote serves Swiss Artisan Businesses, initially focusing on French-speaking artisans. An Artisan understands the proposed work and supplies the information needed to prepare a Quote. Customers and Quotes belong to the Artisan Business.

## Product purpose

Help artisans prepare Quotes much faster, from capturing proposed work to producing a PDF they can send to a Customer. This includes structuring the Quote and automatically calculating prices from the entered quantities, unit prices and fixed amounts.

The intended workflow starts on a phone at the job site, ideally with spoken input. The Artisan returns to the office to fine-tune the Quote before sending it to the Customer.

## Operating context

The phone supports initial capture while the Artisan is at the job site. The office supports later review, correction and completion. Both stages concern the same Quote, rather than separate mobile and office documents.

The current web application combines conversation with direct editing of a Working Draft. It supports French and English interfaces. A Quote's customer-facing language is independent of the Artisan's interface language. Current calculations use CHF.

Speech input is a confirmed product goal, not a shipped capability. The current implementation and its limits are described in `docs/quote-workflow.md`.

## Capabilities and constraints

### Current application

- Email/password authentication, reusable Customer records and business defaults support Quote preparation.
- Conversation and manual editing update the Working Draft. Quote Lines can have quantity-based or fixed prices, and optional Quote Sections organize work.
- The application calculates amounts and validates commercial data. The assistant may propose quantities and prices, but application validation does not establish that those proposals are commercially correct.
- Incomplete Working Drafts are allowed. Business setup must not block starting a Quote.
- The Artisan downloads a customer-ready PDF (Quote Document) of any Published Revision and sends it manually. A Draft Preview of a Working Draft is marked as a draft. PDFs are rendered on demand in the Quote Layout recorded at Publication and are not stored (ADR 0004, ADR 0005). An optional business logo is copied into new Quotes and freezes with each revision. In-app delivery and acceptance tracking are out of scope. See `docs/quote-pdf.md`.
- The Artisan explicitly approves Publication. The assistant cannot publish a Quote on the Artisan's behalf.
- Publication freezes commercial content and calculated amounts in a numbered Published Revision. Later corrections require a new Working Draft and another Publication.
- Publication does not send a Quote or establish Customer receipt or acceptance.
- Reusable Customer and business changes do not silently alter existing Quotes.
- Server-accepted edits persist. Unsaved local edits do not survive browser closure or a crash. Do not imply offline capture or guaranteed cross-device continuation of unsaved work.
- Hosted AI processing has disclosure and provider-data constraints. Preserve the safeguards documented in `docs/quote-ai.md`.

### Intended capabilities and open decisions

- Support starting a Quote by speech on a phone at the job site. The speech-capture mechanism, recording retention and behavior with poor connectivity remain undecided.
- Offer more Quote Layouts and layout options, chosen per Quote. The first release has only the standard layout.
- Reduce the time needed to prepare Quotes. No numerical time-saving target or measured claim has been established.

## Product principles

- Optimize the full path from job-site capture to a Quote ready to send, not only the office editing step.
- Let artisans capture incomplete work and refine it later without re-entering what they already supplied.
- Use conversation to help structure work and direct editing to let artisans inspect and correct the result.
- Calculate amounts consistently while keeping commercial review and Publication under the Artisan's control.
- Support French-speaking Swiss artisans first while preserving the existing separation between interface language and Quote language.

## Evidence on hand

- `CONTEXT.md` defines the domain language and ownership rules.
- `docs/quote-workflow.md` describes the implemented workspace, persistence behavior and calculation boundaries.
- `docs/adr/0003-freeze-published-quote-revisions.md` records Publication and revision rules.
- `app/components/quote-prototype/` preserves the approved office-workspace prototype and its handoff. It is implementation evidence, not proof that speech capture or PDF output exists.
- The user confirmed the initial audience, phone-to-office workflow and product goals during this init. No measured time savings or customer testimonials were supplied.

## Standalone evaluator context

This section applies only to the local Easy Quote evaluation tool launched with `npm run eval:start`, not the main application.

### Users

The developer uses this tool locally on their own machine to test models against Easy Quote scenarios.

### Product purpose

Configure Evaluation Sessions using existing scenarios and inspect why individual Scenario Runs failed. Selecting existing scenarios is the usual launch workflow. Cross-session model comparison and custom-input authoring are outside this redesign.

### Operating context

The evaluator is a standalone local web server. It saves session plans, progress, Scenario Run results and human reviews locally. It is separate from the production application and uses an isolated evaluation database.

### Capabilities and constraints

Preserve scenario selection, provider and model settings, reasoning, repetitions, execution limits, explicit Start authorization, progress, Stop, settings reuse, saved results and human review. Preserve access to scenario inputs, expectations, Quote comparisons, conversation and tool diagnostics.

Provide light and dark themes, initially following the system preference and remembering an explicit choice on this browser.

Distinguish execution status, automated outcomes and human review. A completed session does not mean its Scenario Runs passed. Reserved budget and estimated usage cost are different values. Redesigning the interface does not authorize paid provider calls.

### Product principles

- Make selecting scenarios and configuring an evaluation direct.
- Prioritize evidence that explains failed Scenario Runs.
- Keep reference material and technical details available without making them dominate routine tasks.
- Preserve existing execution and data-isolation safeguards.
