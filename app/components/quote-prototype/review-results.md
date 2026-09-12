# Prototype browser reviews

## v0.4 single-icon collapsed rail

- B's expanded heading is now Sections with no aggregate line count. Its sidebar links remain in place.
- At 1440px, the expanded rail measures 176px; collapsed it measures 52px and exposes exactly one button, Expand sections. The document-toolbar toggle has been removed.
- Mouse collapse and keyboard expansion preserve focus on the same button and update aria-expanded. Hidden section links are not focusable. Section jumping and the document's scroll position across collapse/expansion were checked.
- The flat Quote still has no rail and retains its CHF 16'249.59 total.
- At 320/375/414/768px, the existing narrow-screen selector stays available, the desktop rail is absent and there is no horizontal overflow. Screenshots inspected at all four widths and both desktop states.
- Typecheck passed. Axe scoped to the expanded rail reported zero violations and zero incomplete checks. Current screenshots: `screenshots/review-v04.png` and `screenshots/review-collapsed-v04.png`.

## Rollback to v0.2

The user clarified that the quick-jump sidebar must remain. Only the manual hide/restore mechanism was meant to be reconsidered. The v0.3 dropdown is withdrawn; v0.2's sidebar, header, collapse icon and Sections restore button are restored. Historical v0.3 checks below do not describe the current UI. Rollback verification passed: typecheck, visible sidebar, hide/restore with focus return, and jumping to Buanderie at 1280px with no horizontal overflow.

## v0.3 section menu proposal for B, withdrawn

- Removed the sidebar, its heading and aggregate line count from B. The Sections dropdown sits in the document toolbar and is absent on sectionless Quotes. A/C retain their comparison layouts.
- At 1280×800, Quote/conversation widths stayed at approximately 705px/511px before opening, while open and after selecting a section. No sidebar-collapse state remains.
- Tested mouse selection, keyboard opening and selection, Escape dismissal and focus return. Left/right arrows inside the menu did not change prototype variants. Selecting a section scrolls it into view and closes the menu.
- Narrow-screen testing caught focus restoration cancelling page scrolling after selection. The close handler now restores focus without scrolling, then performs the jump. Retested at 320/375/414px: destination headings land approximately 16px below the viewport top. At 768px, navigation scrolls the document pane instead of the page.
- Menu-open screenshots inspected at 320, 375, 414, 768 and 1440px. No horizontal overflow; menu stays inside the viewport. Menu items are 44px tall. The mobile trigger is also 44px tall.
- The 14-line flat sample showed no navigation trigger. Adding its first section exposed a one-item menu without changing the line count or CHF 16'249.59 total. Section management and line editing remain separate from navigation.
- Axe audit scoped to the open menu: zero violations and zero incomplete checks. This does not replace the earlier whole-page review.
- TypeScript typecheck and production build passed. No browser errors reported. Screenshots: `screenshots/review-v03.png` and `screenshots/review-menu-v03.png`.
- This replaces v0.2's sidebar proposal and awaits user review. No final #8 approval is implied.

## v0.2 refinement of B

- Preferred direction: B, as requested by the user. The 58/42 ratio and adaptive sidebar are proposed refinements, not final design approval.
- At 1280×800, the Quote is approximately 594px wide and conversation 430px with the section rail open. The transcript viewport is 339px high after removing the extra copy and moving scripted requests into the scenario dialog.
- Follow-up discoverability pass: added a collapse icon directly in the index header and a labelled Sections toggle in the document toolbar. Browser check confirmed that closing the index transfers focus to the toggle, sets aria-expanded=false and hides the rail; reopening restores it without horizontal overflow.
- Collapsing the rail returns its space to the panels, approximately 705px Quote and 511px conversation at that width. Collapse/reopen controls worked. The 14-line flat sample had no visible rail; its section-creation control remained available and its total stayed CHF 16'249.59.
- Scripted supplied-value completion worked from the scenario dialog, which closed when the request started. Existing per-line editing was not changed.
- B in English at 320, 375, 414, 768 and 1280px: no horizontal overflow. Inspected all screenshots. Narrow-screen page scrolling still makes the composer reachable above the floating switcher.
- Full axe audit at 1280px: zero reported violations. The same offscreen document-caption contrast check remains incomplete, as documented below.
- TypeScript typecheck passed.

## v0.1 browser review

Reviewed locally with agent-browser and Chromium on 2026-09-11. This is prototype rehearsal, not an acceptance-test suite or approval of the design.

## Layout and language

- A/B/C at 320, 375, 414, 768 and 1280×800: no horizontal overflow in the final 15 checks.
- A/B/C at 1440×1000: screenshots captured in `screenshots/`.
- Initial EN checks covered A/B/C at 320 and 414px. Final desktop language-switch check confirmed English interface controls with the commercial article still marked `lang="fr"` and unchanged French title.
- The first narrow-screen pass found request controls partly clipped by a height cap. Removed the cap and switched small screens to page scrolling. All suggested actions were reachable at 320px in the recheck, without composer overlap.
- B/C gain the same section select as A at constrained widths. Selecting Entrée in C's narrow Quote panel changed the reviewed section successfully.
- Conversation history remains independently scrollable. At some desktop heights a previous message meets the top scroll boundary partway through a line. The latest exchange is visible; this is a remaining visual refinement rather than content loss.

## Accessibility

Full axe audits reported zero violations for A/B/C at all 15 final viewport combinations. A final WCAG A/AA check of A at 1440×1000 also reported zero violations.

Axe left one manual-review item, `color-contrast`, for the document caption below the visible scroll boundary. This is an incomplete check, not a pass or a reported violation. The caption consumes the muted-text/canvas token pair. A browser canvas conversion and WCAG calculation for C measured 6.10:1 for that pair, 15.38:1 for ink/paper, 9.35:1 for primary button text/fill and 7.62:1 for warning text/background. The other layouts' visible contrast checks passed axe.

Dialogs trap focus and return it to their opening control. Invalid numeric submission keeps the dialog open and focuses the invalid field. Keyboard-operable controls exist for line/section movement and duplication. No drag-only or hover-only essential action was introduced. A full screen-reader rehearsal and final focus rules after structural edits remain open.

## Rehearsed behaviour

- Initial incomplete Quote has two missing values and no final total.
- Filling the disclosed 650 CHF fixed amount and 4.800 m quantity restores the independently checked CHF 64'182.73 total.
- Publication review blocks incomplete and unsaved content. Explicit confirmation freezes a revision and says that nothing was sent.
- Editing a fixed price to `-25` is rejected; `0` applies and shows Sans frais. Undo restores the previous missing price.
- New revision draft with a 3% discount shows CHF 65'533.95. Reading revision 1 still shows CHF 64'182.73. Resuming returns to the draft.
- Assistant failure keeps Quote content unchanged; Retry completes the scripted action.
- Slow AI plus a manual line edit produces stale-response rejection and keeps the manual correction.
- Save failure exposes Not saved and Retry. Publication confirmation stays disabled. Retry restores the simulated Saved status.
- New Quote starts without an administrative form. The oak-cladding request adds 12 m² at 180 CHF/m². The in-memory Quote list reopens it with the CHF 2'160.00 amount and conversation intact.

No external AI, server mutations, persistence or original customer documents were used.

## Hallmark review

Self-critique: Philosophy 4, Hierarchy 4, Execution 4, Specificity 5, Restraint 4, Variety 4.

The three options differ in panel placement, conversation allocation, section navigation and whole-document versus focused-section review. Tokens, roman headings, visible focus, meaningful change indicators, reduced motion and single-library icons were reviewed. No marketing metrics, fake device frames, decorative imagery, gradient headlines or dashboard cards were introduced.

This is an application, so the marketing hero/footer gates do not apply. Compact administrative labels and numeric rows are intentionally smaller than running conversation text. Component-state and spacing choices remain exploratory, not an approved production design system. No blanket automated Hallmark score is claimed.
