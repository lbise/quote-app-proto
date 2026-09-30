---
version: 1
slug: "app-components-quotes-quote-header-tsx"
primary_target: "app/components/quotes/quote-header.tsx"
related_targets: ["app/routes/home.tsx","app/components/quotes/workspace.tsx","app/components/customers/customers-page.tsx","app/components/settings/settings-page.tsx","app/components/quotes/app-pages.css"]
---

# App shell and management pages

Mode: Operate. Scope: every authenticated page of the main app (shared shell, quote list, quote workspace styling, customers, settings, admin, auth pages). The quote workspace keeps its approved layout (sections rail, document, conversation); only its styling follows the chosen direction. Audience: French-speaking Swiss artisans; phone at the job site in daylight, office desk later. "easyquote" is a placeholder name: no direction may lean on the wordmark.

Three directions are built side by side behind a dev-only design switcher (cookie, server-rendered) so the three founders can vote on the VPS dev server; "0" keeps the incumbent look for comparison. Each direction ships a light and a dark theme (follow system until chosen; dark is opt-in because of the daylight scene). After the vote, the winner's contract stays, the others are deleted.

## Direction contract

THESIS: The artisan's own paperwork and street furniture, not a generic SaaS dashboard, carries the product: quotes read as numbered, stamped, labelled objects with fixed-column amounts.

OWN-WORLD: A · Plaque émaillée: ultramarine enamel field owns navigation (left rail desktop, labelled bottom bar phone), white paper content, quote numbers as house-number plates, status as labelled enamel plaques, Frutiger-like sign sans; dark = night enamel. B · Carnet de devis: carbon-copy quote pad; white sheets, carbon-blue printed rules, red numbering-machine numerals, NCR tints (yellow draft, white published, pink archived) always with text, pad divider tabs as nav, ruled register list, A–Z address book; dark = the carbon sheet itself. C · Canon: neutral sidebar SaaS at Bexio/Linear/Stripe-dashboard craft, one brand colour, dense sortable tables.

STORY: Log in, land on Quotes, scan amounts/status/dates, open a quote, act (publish, PDF, archive) from the document toolbar on desk or phone, reach customers and settings from labelled navigation everywhere.

FIRST VIEWPORT: Quote list: persistent labelled navigation, page title with New Quote as the one primary action top right, then the list as a table (reference, project, customer, status, amount right-aligned tabular, updated date). No hero, no kicker.

FORM: A assigned (candidate 7 of 7: enamel signage); B impeccable's pick (candidate 1: duplicate quote pad); C canon. Raises from declined challengers: every control labelled, no icon-only nav (busytown labels); amounts in fixed tabular slots that never reflow (seven-segment). Seed key 53a74661. Code-led (no image generation).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
