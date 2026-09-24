---
name: Easy Quote evaluation workspace
description: Design system for the standalone local evaluator only, not the customer-facing Easy Quote application.
colors:
  paper: "#ffffff"
  canvas: "#f3f5f8"
  hover: "#e9edf3"
  selected: "#eaf1ff"
  ink: "#202733"
  muted: "#566273"
  rule: "#d4dae3"
  control: "#8c98a8"
  accent: "#245bb5"
  on-accent: "#ffffff"
  focus: "#245bb5"
  error: "#ad2c36"
  error-bg: "#fff1f2"
  success: "#236b46"
  success-bg: "#eaf6ef"
  dark-paper: "#1b2028"
  dark-canvas: "#14181f"
  dark-hover: "#2c3440"
  dark-selected: "#253650"
  dark-ink: "#e5eaf1"
  dark-muted: "#a8b3c3"
  dark-rule: "#384251"
  dark-control: "#66758b"
  dark-accent: "#9abfff"
  dark-on-accent: "#15233a"
  dark-focus: "#9abfff"
  dark-error: "#ff9da6"
  dark-error-bg: "#37252c"
  dark-success: "#8ad7ad"
  dark-success-bg: "#20382d"
typography:
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.025em"
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
  section:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: ".8125rem"
    fontWeight: 550
    lineHeight: 1.5
  hint:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: ".8125rem"
    fontWeight: 400
    lineHeight: 1.5
  status:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: ".75rem"
    fontWeight: 600
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: ".8125rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: ".25rem"
  panel: ".375rem"
spacing:
  "2": ".125rem"
  "4": ".25rem"
  "6": ".375rem"
  "8": ".5rem"
  "10": ".625rem"
  "12": ".75rem"
  "14": ".875rem"
  "16": "1rem"
  "20": "1.25rem"
  "24": "1.5rem"
  "28": "1.75rem"
  "32": "2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: ".5rem 1rem"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".5rem 1rem"
  button-compact:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".25rem .625rem"
  button-theme:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: ".5rem 1rem"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".5rem .625rem"
  nav-current:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: ".5rem .75rem"
  status-neutral:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
    typography: "{typography.status}"
    rounded: "{rounded.control}"
    padding: ".125rem .5rem"
  status-failed:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
    typography: "{typography.status}"
    rounded: "{rounded.control}"
    padding: ".125rem .5rem"
  status-passed:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    typography: "{typography.status}"
    rounded: "{rounded.control}"
    padding: ".125rem .5rem"
  session-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: ".875rem 1.25rem"
  evidence-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "0 1.25rem"
  failure-table:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    width: "100%"
---

# Design System: Easy Quote evaluation workspace

## Overview

**Creative North Star: "Debugger workspace"**

This system applies only to the standalone local evaluator under `eval/`, launched with `npm run eval:start`. It does not define or replace the customer-facing Easy Quote application's design. Preserve the product app outside `eval/`.

Neutral divided panes, compact labelled controls and a blue action accent support scenario selection and failure inspection. Light and dark themes retain the same hierarchy. Evidence stays available through disclosures and links rather than a permanent reference sidebar.

**Key Characteristics:**
- Compact system typography and bordered work panes.
- Semantic outcomes with explicit text labels.
- Light and dark themes with matching structure.

Extracted from `eval/report.css`, `eval/report.ts`, `eval/execution-report.ts` and `eval/report-ui.js`. Execution guidance also reflects `eval/execution-client.js`. The approved direction lives in `.impeccable/surfaces/eval-report-ts.md`; evaluator scope lives in `PRODUCT.md`.

## Colors

### Primary

The blue `accent` marks actions, links and current navigation; `selected` supplies its pale selection background. `on-accent` is action text. `focus` supplies keyboard outlines.

### Neutral

`canvas` sits behind `paper` panes. `ink` carries content, `muted` carries supporting text, `rule` divides regions, and `control` gives fields a stronger boundary. `hover` marks neutral feedback.

### Semantic states

`error` and `error-bg` mark failed or invalid automated outcomes and execution issues. `success` and `success-bg` mark passed automated outcomes. Neutral execution states remain distinct from these outcomes and from human review.

Unprefixed frontmatter colors are the light palette. Each `dark-` counterpart replaces the same `--color-*` property under `data-theme="dark"`. Component references describe the light defaults; live CSS variables select the active palette. Sidecar tonal ramps are synthesized preview metadata, not additional application colors. Follow system preference until the user chooses a theme; remember that choice using `easy-quote-evaluation-theme` in browser storage. The toggle names the theme it will switch to.

## Typography

Use the system UI stack for headings, controls and report text. These are compact application headings, not display typography. Use the system monospace stack for paths, JSON and diagnostics; load no web fonts.

The frontmatter records the page title, section hierarchy, body, labels, hints, status text and code block styles. Legends use a slightly larger label treatment with semibold weight. Numerical comparisons, totals and progress use tabular figures. Preserve wrapping for long identifiers and diagnostic content.

## Layout

The centered workbench caps at 1504px. Desktop main content has 2rem padding. Launch places selection beside configuration with a 1.25fr / minimum-360px grid and a 1.5rem gap. The library uses a 1:2 grid; Quote comparisons use equal columns.

At 1100px and below, launch narrows its gap, search controls stack, session summaries reorganize and the progress overview stacks. At 760px and below, navigation moves onto a full-width row; main padding becomes 1.25rem 1rem. Launch, library, comparison and review fields become single-column. Scenario selection retains its own scroll area, capped at 23rem on mobile.

On mobile, failure-table rows stack. Keep the caption full-width, retain visually hidden column headers, preserve explicit header associations, and show Expected/Actual labels beside the values. Do not replace semantic headers with labels alone.

Spacing keys name pixel-equivalent steps at the default root size; their rem values come from the stylesheet. Dense control gaps and larger pane gaps serve different levels of grouping.

## Elevation & Depth

No box shadows. Paper panes, canvas backgrounds and thin borders establish depth. Keyboard focus uses a 2px accent outline with a 3px offset; targeted execution steps use the same outline with a .5rem offset. Do not treat these outlines as elevation shadows.

## Shapes

Controls, status labels, notices and failure items use the smaller corner token. Fieldsets, session cards, evidence and progress panes use the panel token. Quote comparison documents remain square-cornered. Borders are 1px; there is no pill-shaped status treatment.

## Components

- Buttons use a filled primary action or a paper secondary action. Compact secondary buttons serve selection tools. Primary hover reduces brightness; secondary hover uses `hover`. Pressing moves a button down 1px unless reduced motion is requested. Disabled buttons use muted text and neutral fill. There are no entrance animations or timed transitions.
- Fields have persistent labels, control-colored borders and shared keyboard outlines. Hints sit below the relevant setting. Native checkboxes use the action accent; selected scenario rows also receive the selection background.
- Navigation uses muted links and a selected background on `aria-current="page"`. Keep the theme control available in both executable and read-only reports.
- Status labels include words. Execution, automated checks and human review remain separately named; completed execution does not mean passed checks.
- Session cards lead with model, date and outcomes. IDs and per-run detail stay in disclosures. Reuse remains a link rather than an implicit launch.
- Evidence panels use native `details` and `summary`. Failure links open enclosing disclosures, scroll to the execution step and move keyboard focus there. Expected and actual values stay adjacent on desktop and labelled when stacked.
- Progress keeps Stop next to reuse. Active execution explains that leaving the page does not stop work; ended execution says saved results remain available. Server-rendered text and polling updates use the same distinction.

## Do's and Don'ts

### Do:
- Do apply these tokens only to the standalone evaluator under `eval/`.
- Do keep execution status, automated outcomes and human review separately labelled.
- Do preserve mobile table captions, accessible headers and visible Expected/Actual labels.
- Do retain keyboard focus feedback and evidence disclosure links in both themes.

### Don't:
- Don't restyle the customer-facing application from this evaluator document.
- Don't imply a completed session passed its automated checks or human review.
- Don't describe ended execution as still running.
- Don't introduce decorative raster assets, web fonts or shadows into this documented workspace.
