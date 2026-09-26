---
target: "Authenticated live review of main quote editing page, http://192.168.1.11:5173/quotes?id=893cd4c0-c45c-4798-8667-73dc7b4845a1"
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/leo/gitrepo/quote-app-proto/app/components/quotes/workspace.tsx"
target_fingerprint: "sha256:d590eab6133210310cb31b4eda570596adab2afd27a079faf16daa6c6ef36fff"
target_path: /home/leo/gitrepo/quote-app-proto/app/components/quotes/workspace.tsx
timestamp: 2026-09-24T18-46-54Z
slug: app-components-quotes-workspace-tsx
---
Method: dual-agent (A: `01a0d4ab-7031-772d-be5b-fd745690078b` · B: `01a0d4ab-c21b-772d-be5b-fd76da991a05`)

## Updated verdict

**Keep the document-first appearance. Make its editing controls obvious, and let users reclaim the assistant's space when reviewing.**

The authenticated review confirms the user's chosen direction. The assistant contains useful conversation; the problem is its mandatory width, not its presence.

Tested the actual quote at **1440×900, 1280×720 and 390×844**, including section navigation, opening and cancelling editors, and publication review. Assessment B additionally checked desktop at 1440×1000. No quote data changed. Saving, AI requests, deletion and final publication were deliberately not exercised.

URL: http://192.168.1.11:5173/quotes?id=893cd4c0-c45c-4798-8667-73dc7b4845a1
Primary implementation: `app/components/quotes/workspace.tsx`.
User direction: assistant remains central but becomes collapsible; prioritize editing discoverability and layout.

## Design specificity

The sections, quantities, CHF amounts and publication rules make this recognizably a quoting tool. The restrained styling fits office work. The mismatch is between its finished-document appearance and its editing purpose: some important controls look like ordinary printed text.

The biggest opportunity is better correction ergonomics, not a new visual identity.

## Design health

| # | Heuristic | Score | Main finding |
|---|---|---:|---|
| 1 | System status | 3/4 | Draft and saved states are clear |
| 2 | Real-world conventions | 3/4 | Familiar commercial structure and pricing |
| 3 | User control | 2/4 | Cancellation works, but navigation and exits can disappear |
| 4 | Consistency | 2/4 | Details and lines expose editing differently |
| 5 | Error prevention | 3/4 | Explicit publication review; validation also exists in source |
| 6 | Recognition over recall | 2/4 | Important editing affordances remain hidden |
| 7 | Efficiency | 2/4 | Fixed split and repeated dialogs slow corrections |
| 8 | Minimalist design | 2/4 | Repeated row controls consume attention and height |
| 9 | Error recovery | 3/4 | Source provides validation, retry and preserved edits; failure paths untested |
| 10 | Help | 2/4 | Useful explanations inside editors, little guidance on discovering them |
| | **Total** | **24/40** | **Acceptable, with significant usability gaps** |

The previous score was 25/40. This is a better-evidenced reassessment, **not evidence that the app regressed**.

## What's working

- **Amounts and structure scan well.** Numbered lines, aligned prices, section subtotals and the persistent desktop total support review.
- **Editing behaves predictably once found.** Cancelling returned focus to the original line control and preserved the document's scroll position.
- **Publication review is reassuring.** It states the amount and revision, explains the frozen content, and makes clear that publication does not send the quote.

## Priority issues

### 1. P1: Editable details look read-only

The title, site address and customer/business details resemble printed text. Pencil indicators appear only on hover or focus. On the phone, tapping the address opened an editor, but nothing beforehand advertised that capability.

**Fix:** Add persistent, discreet “Modifier” affordances to editable groups. Use a consistent pattern across title, addresses and customer details, while keeping frozen revisions visibly read-only.

Evidence: `app/components/quotes/quotes.css:130–138`  
Suggested command: `/impeccable clarify`

### 2. P1: The permanent assistant split constrains review

At laptop width, the quote pane was **594px wide**, beside a **430px assistant**. Its document viewport was only **467px high**. After jumping to a populated section, just three complete lines fitted in view.

At the top, the document header and this quote's empty first section further postpone priced work. The empty section is legitimate content, not itself a defect.

**Fix:** Add a labelled collapse/reopen control for the assistant. Preserve conversation and unsent input. Let the document reclaim the width, and reduce unnecessary vertical overhead without shrinking text.

Evidence: `app/components/quotes/quotes.css:195–210`  
Suggested command: `/impeccable layout`

### 3. P1: Quantity editors hide their exit controls

This is newly verified. On the laptop, both footer buttons were clipped when the quantity editor opened. On the phone, “Appliquer” was visible while “Annuler” was partly clipped. Scrolling made cancellation possible, but the exit should be visible immediately.

**Fix:** Give the form one scrolling body and a fixed footer containing Cancel and Apply. Include the line number in the heading. Focus the field being edited rather than always starting with section assignment.

Evidence: `app/components/quotes/manual-editor.tsx`, `LineEditor`; `quotes.css:214`  
Suggested command: `/impeccable harden`

### 4. P1: Mobile section jumps leave navigation behind

Selecting Zone G worked, but scrolled more than **6,500px** down the page. Conversation/Devis switching and the section chooser remained thousands of pixels above. The total also loses its persistent position on mobile.

**Fix:** Keep compact panel switching and section navigation accessible while scrolling. Preserve each panel's position and reduce the stacked toolbar height.

Evidence: `app/components/quotes/quotes.css:289–295`  
Suggested command: `/impeccable adapt`

### 5. P2: Every line repeats five small actions

Edit, duplicate, move up, move down and delete appear on every line. Edit labels are **10px**; desktop icon targets are approximately **28px**. Across 30 lines, that adds substantial visual noise.

**Fix:** Keep an obvious Edit action and group secondary operations in a menu. Enlarge frequent touch targets and preserve keyboard access.

Evidence: `app/components/quotes/workspace.tsx:232–237`  
Suggested command: `/impeccable distill`

## Cognitive load and emotional journey

Six checklist concerns appeared: competing focus, dense action groups, hidden editing hierarchy, repeated choices, context lost inside dialogs, and poor disclosure of secondary actions. Grouping and isolating individual corrections were strengths. The eight sections are useful navigation; the repeated five-action line toolbar is the stronger overload problem.

The page starts confidently with a saved state and clear total. Confidence drops during correction, especially when controls are concealed or Cancel is clipped. Publication review restores it with clear consequences.

## Persona red flags

- **First-time artisan:** Can discover “Relire et publier” before discovering how to correct the customer address.
- **Office power user:** Cannot reclaim assistant width and repeatedly enters full dialogs for small corrections.
- **Mobile artisan:** Can jump to the last section but loses convenient access to conversation and the next section.

## Automated evidence and smaller issues

- **Axe found no violations** in the tested desktop, mobile conversation and mobile quote states. This does not certify dialogs, screen-reader use or untested states. Audits were run with detector annotations excluded to prevent instrumentation contamination.
- The browser detector reported **45 findings**: 41 `undersized-ui-text`, one `tiny-text`, one `flat-type-hierarchy`, and two `nested-cards`. Forty-two concern small text, mostly repeated instances. Its other three findings misinterpret a hidden heading and ordinary chat bubbles. Relevant small-text CSS locations: `app/components/quotes/quotes.css:99,108,121,145,168`.
- The source detector's **30 advisories** compare the app against evaluator-only `DESIGN.md` rules. Those are scope false positives. All in `app/components/quotes/quotes.css`: 29 `design-system-font-size` at lines 21,30,47,91,95,99,108,109,121,123,125,145,161,165,168,172,173,181,187,193,237,300,306,310,317,319,322,326,340; one `design-system-radius` at line 52.
- “Zone G” wraps onto two lines on mobile despite available width. Fix the heading's sizing.
- Section menus remain **28×28px** on mobile. Improve touch sizing; sub-44px targets are not automatically WCAG AA violations.
- No horizontal page overflow was observed. Sampled text contrast passed.
- Section highlighting follows selection rather than the section currently in view.

Actual detector annotations remained available at handoff in dashboard session **`quote-live-b`**, in the **[Human]** tab. Reloading removes them. The temporary detector server was stopped.

For the first implementation pass, recommend visible edit affordances, assistant collapse, and the editor-footer fix. The footer problem belongs in that pass because it directly affects the editing experience the user prioritized.

## Questions to consider

1. Make editable details discoverable with persistent “Modifier” labels, or an explicit document editing mode? Recommend persistent labels.
2. Have the collapsible assistant remember its open/closed state on this device, or open by default on every visit? Recommend remembering the choice.

## Evidence archive locations

Screenshots: `/tmp/quote-live-a/desktop-1440.png`, `desktop-zone-a.png`, `desktop-line-editor.png`, `desktop-publication-review.png`, `laptop-1280.png`, `laptop-quantity-editor.png`, `phone-390.png`, `phone-conversation.png`, `phone-zone-g.png`, `phone-line-editor.png`, `phone-site-editor.png`.

Mechanical evidence: `/tmp/quote-live-assessment-b.md`; raw JSON, geometry, audits, contrast samples and detector captures under `/tmp/quote-live-assessment-b/`. These temporary evidence files are not durable repository artifacts.
