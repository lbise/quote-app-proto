---
version: 1
slug: "app-components-app-shell-tsx"
primary_target: "app/components/app-shell.tsx"
related_targets: ["app/components/design-switcher.tsx","app/styles/design-c.css","app/routes/quotes.tsx","app/components/customers/customers-page.tsx","app/components/quotes/workspace.tsx"]
---

# App shell and management pages

Mode: Operate. Scope: every authenticated page of the main app plus auth pages. The quote workspace keeps its approved layout (sections rail, document, conversation side by side); only styling follows the direction. Mobile first: the phone view is judged first. "Easy Quote" is a placeholder name.

The founders rejected the invented worlds (A enamel, B carbon-copy pad) and chose the canon. Four presets of one standard design are compared through a dev-only switcher that also exposes the individual taste dials, two navigation modes and a phone-frame preview. After the vote, the chosen preset and navigation mode are kept and the switcher is removed; the Light/Dark/System toggle stays.

## Direction contract

THESIS: Standard product software at Linear/Stripe/Vercel finish; the craft is spacing, alignment, states and numerals, not a concept. Refuse Bexio/Klara-grade business UI.

OWN-WORLD: Restrained colour: neutral greys plus one accent. One workhorse sans. 1px borders, one soft elevation for menus and dialogs only. Taste dials: font, accent, neutral temperature, radius, density, accent use, panel style, badge style. Four presets: Graphite, Sarcelle, Forêt, Indigo.

STORY: Log in, land on Quotes, scan status and totals, open a Quote with the conversation beside it, act from the toolbar, reach Customers and Settings from labelled navigation. On a phone: start or continue a Quote with the thumb.

FIRST VIEWPORT: Phone: compact title bar, the quote list grouped by status or as rows, a thumb-reach New Quote action, labelled bottom tabs. Desk: a slim top bar (or a sidebar that gives way to a full-width focus bar in the Quote workspace), title left, primary action right, dense table.

FORM: Canon (standing exit), references Linear, Stripe, Vercel. Seed key 53a74661. Code-led.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
