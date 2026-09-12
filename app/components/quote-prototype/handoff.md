# Approved layout B v0.4

The user approved the current layout and requested closure of #8 with screenshots. This document records the approved workspace and the details still needed for #7. Approval is not evidence that the simulated workflow is production-ready.

## Reference artifacts

- [Expanded sidebar](screenshots/review-v04.png)
- [Collapsed sidebar](screenshots/review-collapsed-v04.png)
- [Runnable prototype and walkthrough](README.md)
- [Browser review results](review-results.md)
- [Fixture provenance and calculations](fixture-notes.md)

Run `npm run prototype:quotes`, then open `/quote-layout-prototype?variant=B`. Add `&lang=en` for English controls. Select B explicitly; A/C and the withdrawn v0.3 screenshots are comparison history, not approved alternatives.

## Approved workspace

- Professional desk workflow with section navigation on the left, the customer-facing Quote in the centre and a prominent conversation on the right.
- Quote/conversation split of 58/42 after allowing for the rail and panel gap. Both document and conversation scroll independently at desk widths.
- Sidebar heading is **Sections**, without an aggregate line count. Expanded navigation includes section links, missing-information indicators and organisation access.
- Collapse leaves a 52px rail with one reopen icon. Keep the same button mounted and focused, update its accessible label and `aria-expanded`, and remove collapsed links from keyboard navigation. No duplicate collapse control in the document toolbar. Expansion restores the section links without resetting document scroll.
- A Quote without sections has no rail. First-section creation remains available in the document toolbar.
- Preserve the existing per-line action rows and dialog-based editors, including duplication, reordering and deletion. The user requested no change to those editing interactions during layout refinement.
- Keep the conversation header concise. The extra subtitle, request-example block and simulation footnote do not belong in its viewport. Prototype scenarios remain outside the conversation. Production must provide the hosted-AI disclosure required by #7, not copy the simulation wording.

## Visual and component references

- `tokens.css`: B's cool near-white paper/canvas, cobalt accent, semantic text and focus colours, spacing and type tokens.
- Space Grotesk for workspace headings and wordmark; Geist for interface and commercial content. Keep commercial content readable rather than recreating printed page breaks.
- `prototype.css`: `.qp-layout-b`, `.qp-review-rail`, document, conversation and constrained-width rules. Expanded rail is 176px, reducing to 140px at intermediate desk widths; panel gap is 16px.
- `workspace.tsx`: `VariantB`, section navigation, status indicators and scripted states.
- `manual-editor.tsx`: existing field and line-editing interactions. Use the established shadcn Button, Dialog, Field and chat components; do not copy the monolithic simulation as the production architecture.

## Behaviour and language

The product contract remains #7, with #6's calculation rules where not superseded. Layout approval changes no domain semantics.

- Distinguish missing inputs, invalid values and deliberate zero prices. Show incomplete sections and partial subtotals without presenting a final complete total. Administrative omissions remain separate from pricing completeness.
- Keep manual editing available during AI processing. Highlight applied changes, support latest-action undo, preserve newer edits when rejecting stale responses, and expose failure/retry states.
- Show actual saving/saved/error states in production. The prototype's timers and in-memory reopening are demonstrations only.
- Publication requires review and explicit confirmation, is blocked by incomplete/unsaved/pending content, and freezes a Published Revision without sending it. Later edits require a Working Draft; saves do not increment revision numbers.
- Use English/French interface labels while keeping commercial content French. Relevant rail labels are Sections, Réduire les sections / Collapse sections, and Développer les sections / Expand sections.
- At widths up to 1000px, retain the Conversation/Quote panel switch and section selector instead of the desktop rail. Up to 600px, the page scrolls with a bounded transcript. These are constrained-width fallbacks, not approval of an on-site/mobile product workflow.

## Remaining work for #7

Do not infer completed design or tested production behaviour for these gaps:

- Reusable Customer selection/creation, business-default editing and optional Customer contact-person fields. The prototype's metadata editor edits Quote snapshots only.
- More detailed focused clarification, numeric multi-line corrections and explanations of retained values. Scripted examples do not demonstrate a general assistant.
- Deliberate undo grouping for section renames, focus after deletion and moving work across sections.
- Source-verified, safely anonymized joinery/cladding adaptation and the full implementation rehearsal. The 30-line joinery fixture is synthetic.
- Authoritative server calculation/validation, ownership, persistence, concurrency, reference allocation, retry safety and hosted-AI configuration/disclosure. None is implemented by this prototype.
- Final bilingual copy and assistive-technology review, plus browser tests against the real implementation. See the review record for the scope and limitations of checks already performed.

These details remain in #7's scope; they are not silently waived by closing the layout ticket. Print/PDF, speech, uploads, delivery and Customer acceptance remain deferred as specified in #7.
