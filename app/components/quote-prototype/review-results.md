# v0.1 browser review

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
