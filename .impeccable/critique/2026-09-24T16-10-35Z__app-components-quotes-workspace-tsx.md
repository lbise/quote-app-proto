---
target: "Main quote editing page, http://192.168.1.11:5173/quotes?id=893cd4c0-c45c-4798-8667-73dc7b4845a1; provisional source-and-fixture review, live access returned 401"
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/leo/gitrepo/quote-app-proto/app/components/quotes/workspace.tsx"
target_fingerprint: "sha256:d590eab6133210310cb31b4eda570596adab2afd27a079faf16daa6c6ef36fff"
target_path: /home/leo/gitrepo/quote-app-proto/app/components/quotes/workspace.tsx
timestamp: 2026-09-24T16-10-35Z
slug: app-components-quotes-workspace-tsx
---
Method: dual-agent (A: `01a0d425-f8ca-772d-be5b-fd71a5c4c45a` · B: `01a0d426-3254-772d-be5b-fd738b33464f`)

## Overall verdict

**The quote looks credible, but editing it is less obvious than reading it.** The strongest improvement would be making office review more document-focused, with clear editing affordances and less space permanently reserved for the assistant.

This is a **provisional critique**. The live URL returned `401` on desktop and mobile. I reviewed the current implementation and the committed long-quote screenshot, not the contents of the requested quote. No quote data changed.

Requested URL: http://192.168.1.11:5173/quotes?id=893cd4c0-c45c-4798-8667-73dc7b4845a1
Screenshot evidence: `tests/browser/quote-long-document.spec.ts-snapshots/long-quote-desk-chromium-linux.png`.

## Design specificity

The numbered lines, room-based sections, CHF amounts and document layout fit artisan quoting well. The surrounding blue-gray shell is conventional, which is fine for a working tool. It doesn't need more personality before it needs better editing ergonomics.

The automatic scan returned **30 advisories** in `app/components/quotes/quotes.css`: 29 `design-system-font-size` findings and one `design-system-radius` finding. All compare the app against `DESIGN.md`, which explicitly covers only the separate evaluator. These are scope false positives, not 30 confirmed defects. Small text still deserves inspection.

No browser detector overlay was available because authentication blocked the editor. Browser usability, contrast and assistive-technology behavior remain unverified.

## Design health

Scores reflect source and screenshot evidence, not tested authenticated interactions.

| # | Heuristic | Score | Main observation |
|---|---|---:|---|
| 1 | System status | 3/4 | Saved, saving and partial-total states are explicit |
| 2 | Real-world language | 3/4 | Appropriate commercial structure and terminology |
| 3 | User control | 3/4 | Undo and cancellation exist |
| 4 | Consistency | 3/4 | Coherent appearance; some interaction inconsistencies |
| 5 | Error prevention | 3/4 | Publication checks and input validation |
| 6 | Recognition over recall | 2/4 | Editable details resemble static document text |
| 7 | Efficiency | 2/4 | Direct editing exists, but repetitive corrections remain laborious |
| 8 | Minimalist design | 2/4 | Repeated row controls and permanently allocated assistant space |
| 9 | Error recovery | 2/4 | Conflict recovery asks users to copy changes themselves |
| 10 | Help | 2/4 | Useful contextual explanations, limited task guidance |
| | **Total** | **25/40** | **Acceptable, with meaningful usability gaps** |

## What's working

- **The document feels like a quote.** Aligned amounts, restrained dividers and section navigation support commercial review.
- **Incomplete work is allowed.** Partial totals and missing-value guidance fit capture at a job site.
- **Publication is explained honestly.** Freezing a revision is distinguished from sending it to the customer.

## Priority issues

### 1. P1: Mobile loses context during review

The responsive implementation hides the quote title/reference below 1000px and initially selects Conversation. On narrow phones, a long document scrolls away from its switching and publication controls.

**Fix:** Keep compact quote identification visible, retain access to Conversation/Quote switching, and remember the last-used panel. Verify this with a long quote on a real phone.

Source: `app/components/quotes/quotes.css:270–295`  
Suggested command: `/impeccable adapt`

### 2. P1: Conflict recovery leaves too much work to the artisan

The conflict message tells users to copy their changes before reloading. That is a weak recovery path for quantities, prices and document structure.

**Fix:** Provide a recoverable copy of local changes and a comparison with the newer server version. Don't make users reconstruct commercial data manually.

Source: `app/components/quotes/workspace.tsx:288`  
Suggested command: `/impeccable harden`

### 3. P2: Important editing controls are hidden

The title, addresses, dates and terms look like finished document text. Their pencil indicators appear only on hover or keyboard focus. Touch users don't get that preview.

**Fix:** Keep a discreet pencil or “Modifier” label visible beside editable groups. Preserve the document appearance, but make its editable state unmistakable.

Source: `app/components/quotes/quotes.css:129–136`  
Suggested command: `/impeccable clarify`

### 4. P2: Review finds problems without consistently helping fix them

Publication review supplies correction links for administrative details, but excludes line and section problems. Users must leave review, locate the problem and return. Some checklist wording remains affirmative even when its icon indicates a warning.

**Fix:** Give every blocker a targeted correction action. State the problem in words, such as “2 lignes sans prix,” rather than changing only the icon.

Source: `app/components/quotes/workspace.tsx:311–312`  
Suggested command: `/impeccable clarify`

### 5. P2: The assistant takes substantial space even when unused

In the committed desktop screenshot, an empty assistant occupies 42% of the document/chat split. Meanwhile, only two complete quote lines fit in view. The large document header and repeated row controls also contribute.

**Fix:** Offer a document-focused review mode with a collapsible assistant. Keep conversation available without requiring it to occupy nearly half the working area.

Source: `app/components/quotes/quotes.css:206`  
Suggested command: `/impeccable layout`

## Cognitive load and emotional journey

Four checklist concerns emerge: dense action groups, too many repeated choices, context carried between panels, and insufficient disclosure of secondary actions. Each line exposes five actions. Keep editing obvious; group less frequent operations.

The document initially feels orderly and trustworthy. Friction appears when users try to correct it: hidden edit targets, repeated dialogs and disconnected publication blockers. Explicit publication rules restore confidence at the end. PDF output remains an acknowledged product gap, not a capability this critique assumes exists.

## Persona red flags

- **First-time artisan:** Can read the customer address without realizing it is editable.
- **Keyboard or screen-reader user:** Faces repeated row controls; publication warnings need explicit textual states. Actual assistive-technology behavior remains untested.
- **Interrupted mobile artisan:** Loses visible quote identity and must switch between conversation and the document to check changes.

## Smaller observations

- Many supporting labels are 10–11px. Check legibility at ordinary laptop distance.
- Row-action targets are 28px on desktop and 40 × 44px on mobile. Give touch actions more room.
- Shift+Enter reaches the send path; Ctrl/Command+Enter inserts a newline. This risks surprising chat users.
- Section highlighting follows selection rather than the currently visible section.

The design does not need a wholesale visual replacement. It needs clearer editing, a better review layout and safer recovery.

## Questions to consider

- Should office editing use a fixed split, a collapsible assistant, or a document-first review mode?
- Should the next pass focus on desktop editing, mobile review, or recovery safeguards?
