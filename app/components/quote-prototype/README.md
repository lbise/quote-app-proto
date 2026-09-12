# Quote layout prototype v0.4

Throwaway work for [#8](https://github.com/lbise/quote-app-proto/issues/8), captured on `prototype/8-quote-layouts`. **The user approved layout B v0.4 and requested closure of #8. Do not merge this throwaway prototype as the implementation of #7.** See the [implementation handoff](handoff.md) and its remaining-work list.

## Question

How should a professional artisan prepare a Quote through a prominent conversation while reviewing and manually correcting its French commercial content alongside it?

The user confirmed the desk audience and the conversational preparation workflow. They specifically asked that conversation be prominent and the design professional. They subsequently selected B for refinement and requested a slightly wider Quote, more vertical conversation space and an alternative to an empty section sidebar on simple Quotes.

## Run

```sh
npm install
npm run prototype:quotes
```

Open <http://localhost:5174/quote-layout-prototype?variant=A>. The command also requests that the browser open this URL. The dev server binds to the network for review from another device. No sign-in, database setup or AI credentials are needed for the prototype.

- `?variant=A`: Desk. Conversation left, full Quote right, compact section selector.
- `?variant=B`: Review. Section index left, collapsible to a narrow single-icon rail; full Quote centre at 58% of the two-panel area, conversation right at 42%. Open **Scénarios et état / Scenarios & state** for scripted requests.
- `?variant=C`: Focus. Wider conversation left, current-section review right. Use **Tout le devis / Full Quote** to review all commercial content.
- Add `&lang=en` for English controls; commercial content stays French. French is the default.

The floating bar switches layouts. Left/right arrow keys also switch, except while editing a field or using a dialog, select, slider or tablist. Changes remain in memory across variant and language switches. URL parameters preserve only the chosen layout and language.

The route is excluded from production routing, with a second production guard in its loader. The floating switcher also has a production guard. The original home workspace and authentication routes are unchanged.

## What is real, what is simulated

Real browser interactions: scrolling, dialogs, keyboard focus, editing, line/section operations, computed amounts, local undo, local revision snapshots and variant selection.

Simulated: all assistant replies, saving, failure/retry, publication and reopening. There are no Quote endpoints, external AI requests, migrations, localStorage or database writes. Refreshing, closing the tab or a development reload loses the entire session. The save indicator describes only the simulation.

Free-form messages receive an explicit explanation that the prototype cannot interpret them. The example requests demonstrate supplied-value completion, a 3% global discount, section duplication with missing quantities and first-work capture. They do not claim to be real AI.

A snapshot copy freezes publication locally. Editing a new draft leaves older copies unchanged. The reference locks after first publication. Publication cannot be undone and never sends the Quote.

The amount display uses scaled integers and half-up cent rounding. This is disposable calculation code for realistic screens, not the approved server boundary for #7. See [fixture-notes.md](fixture-notes.md) for provenance and independently calculated expectations.

## Design choices to compare

| | A: Desk | B: Review | C: Focus |
| --- | --- | --- | --- |
| Conversation | About 44% of the working width | 42% after the optional section rail | About 56% |
| Review | Whole document | Whole document, conditional/collapsible index | One work section by default |
| Type | Geist UI/document, Space Grotesk wordmark | Space Grotesk headings, Geist content | Newsreader headings/document, Geist conversation |
| Palette | Warm near-white, restrained rust accent | Cool near-white, cobalt accent | Green-tinted neutrals, dark green accent |
| Main trade-off | Easy comparison, less navigation | Wider document; section navigation only when useful | More room to converse, explicit step to inspect the whole Quote |

All three show customer-facing content separately from editor warnings and controls. Missing values display a dash, never zero. Deliberate zero prices show **Sans frais**. Incomplete pricing shows a partial subtotal and withholds the final total. Missing administrative details do not suppress valid calculations.

Tokens are in root `tokens.css`. The prototype stylesheet consumes them and maps them onto shadcn's semantic variables only while the prototype is mounted. Original global styling is unchanged. Hallmark themes and page structures were adapted for a working app: no marketing hero, decorative image, marketing footer or fake browser frame.

### Constrained widths

At widths up to 1000px, Conversation and Quote switch between panels. Each layout keeps a section selector available. At widths up to 600px, the page itself scrolls, with a bounded conversation history; the composer and example requests remain reachable without overlapping. The Quote becomes a single-column document with pricing beneath the description where needed. This is a constrained-width fallback, not validation of an on-site/mobile workflow.

### Editing and focus

Line controls remain visible rather than appearing only on hover. Reordering uses buttons, not drag-only interaction. A labelled modal handles description, section and pricing fields. Blank values are allowed; negative prices, zero quantities and excessive precision are rejected. Invalid submission focuses the erroneous numeric field. Zero amounts are allowed. Metadata uses grouped disclosure sections and an explicit Apply button; these changes affect the Quote snapshot only.

Radix dialogs trap focus, close on Escape and return focus to the opener. The composer supports Ctrl/Cmd+Enter. Visible focus outlines are immediate. Reduced motion disables spatial animation. Conversation scrolling uses shadcn MessageScroller, not a custom scroll-follow implementation.

## v0.4 section rail

The user clarified the intended change: keep the sidebar, call it **Sections**, remove its aggregate line count, and collapse it to an icon-only rail rather than hiding it completely.

- The expanded sidebar retains its section links and organisation control.
- The header icon collapses it to a 52px rail containing only the reopen icon. The same button stays mounted and focused, with a translated label and aria-expanded state.
- There is no duplicate hide/restore control in the document toolbar. The rail icon restores the full sidebar.
- Quotes without sections still omit the sidebar entirely. Narrow screens retain their existing section selector instead of a desktop rail.
- The 58/42 split, document scroll position, editing and publication behaviour are unchanged.

Screenshots: [expanded](screenshots/review-v04.png), [collapsed](screenshots/review-collapsed-v04.png). The user approved this version and requested no further layout changes.

## Previous navigation proposals

The v0.3 dropdown misunderstood the request and was withdrawn. The user first requested a rollback to v0.2, then specified the v0.4 behaviour above. Older screenshots and review notes remain as history, not the current design.

## v0.2 refinement of B, historical

- Try a 58/42 Quote/conversation split. The exact ratio is an experiment, not an approved constraint.
- Remove the header subtitle, the request-example block and the simulation footnote from the conversation. Scripted requests and the full simulation disclosure remain in the scenario dialog, keeping the transcript area available for messages. A/C retain their original conversation chrome for comparison.
- Hide the section rail completely when the Quote has no sections. For sectioned Quotes, the rail starts open and the collapse icon in the index header hides it. The labelled **Sections** button beside **Le devis / The Quote** restores it or toggles it closed. Closing from the index moves keyboard focus to that button. These controls do not change the Quote or its scroll position.
- The organisation control remains in the document toolbar, including **Ajouter une section / Add a section** on a flat Quote. A new section can therefore be created without an existing sidebar.
- Keep per-line editing and publication behaviour unchanged. The current controls launch the existing line editor; no new editing interaction is implied by this pass.
- New/reopened samples reset document scrolling; collapsing the sidebar does not.

Screenshots: [B with sections](screenshots/review-v02.png), [B with a flat Quote](screenshots/review-flat-v02.png). The original screenshots remain as v0.1 comparison artifacts.

## Walkthrough

For B, run the example requests inside **Scénarios et état / Scenarios & state**; selecting one closes the dialog and starts the simulation. A/C still show them above the composer.

1. Start at A with the incomplete 30-line example. Compare B and C without changing the content. Inspect the long descriptions, section subtotals, terms and whole-Quote totals.
2. Open **Relire et publier / Review & publish**. Confirm publication is blocked by missing prices.
3. Use **Compléter les valeurs / Complete the values**. The request discloses the two supplied values. Inspect the changed lines. The complete total is CHF 64'182.73. Use Undo to reverse both changes together; complete again.
4. Edit a line manually. Try `-25`, then `0`. Negative values should not apply; zero is valid and distinct from missing. Try `4,800` for a quantity and a four-decimal quantity to inspect validation.
5. Duplicate, move or delete a line. Undo the latest action. Use **Organiser / Organise** to rename, reorder, duplicate or delete a section with its lines.
6. In the request examples, duplicate the current section without new quantities. Inspect the retained unit prices and fixed amounts, blank quantities and incomplete subtotal.
7. Under **Scénarios et état / Scenarios & state**, choose assistant failure. Close the dialog and run an example request. Retry after failure. Choose slow AI, run a request, then apply a manual edit during the nine-second wait. Confirm the stale response is rejected.
8. Choose save failure and edit or run a request. Wait for the final save attempt to fail. Publication is blocked. Retry saving from the status indicator; local edits remain visible.
9. Load the complete 30-line sample. Review and explicitly confirm publication. Inspect the read-only revision and the note that nothing was sent.
10. Create a new revision draft, change the discount to 3%, then inspect revision 1. It retains CHF 64'182.73; the new draft is CHF 65'533.95. Resume the draft and publish revision 2. Revision numbers change only at publication.
11. Open **Mes devis / My Quotes**, then reopen a Quote. Draft and conversation return in the same tab. A Quote without a draft opens its latest published revision read-only.
12. Use the empty-list scenario, start a Quote without a setup form, and try the oak-cladding request. Complete administrative details later through the metadata editor. Load the flat 14-line example to compare document density.

## Review record

- TypeScript typecheck and production build passed. Production build omits the prototype route and its JS/font assets.
- Browser rehearsal covered first-work capture, list reopening, blocked publication, supplied-value completion, line validation, zero amount, undo, AI failure/retry, stale-response rejection, save failure/retry and revision isolation.
- Initial FR layout review covered A/B/C at 320, 375, 414, 768 and 1440px. EN review covered all variants at 320 and 414px. The review found no horizontal overflow but found partly hidden request controls at 320/375px; the small-screen layout was revised rather than retaining that clipping.
- Final responsive/accessibility results are recorded in `review-results.md`.
- Desktop screenshots: [Desk](screenshots/desk.png), [Review](screenshots/review.png), [Focus](screenshots/focus.png).

## Remaining implementation and design details

The user accepted the current layout and requested closure of #8. That approval does not make the following missing prototype coverage complete or remove #7's requirements. Carry these details into the implementation handoff.

- No reusable Customer picker/creation flow or separate business-default editor. The metadata editor covers Quote snapshots only. Optional Customer contact-person editing still needs design.
- The joinery fixture is synthetic. It does not claim source verification or cladding-reference coverage. A privacy-reviewed adaptation of the supplied source is still required.
- Conversation examples are scripted, not comprehensive clarification or correction behaviour. Focused per-field clarification, explicit numeric multi-line corrections and richer before/after explanations need further design work.
- Section renaming applies per keystroke in this prototype; undo grouping/focus after deletion and moving work across sections need a deliberate final design.
- Reference suggestions and uniqueness are illustrative, not a business-scoped concurrent allocator. No recovery after refresh, no leave-warning guarantee and no real autosave protocol are implemented.
- The approved workspace is represented by v0.4 and its screenshots, not a complete specification for every screen. Final bilingual copy, assistive-technology review and hosted-AI disclosure wording still need attention. Print/PDF design remains outside this slice.

The [handoff](handoff.md) records the approved decisions and remaining details for #7. Production behaviour must follow #7 rather than copying the simulation.
