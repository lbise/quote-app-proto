# Quote PDFs

This is the agreed specification for PDF output. It uses the terms defined in `CONTEXT.md`: Quote Document, Draft Preview and Quote Layout. ADR 0004 and ADR 0005 explain the rendering decisions.

## Scope

- The Artisan downloads a PDF and sends it manually. In-app sending and acceptance tracking are out of scope.
- A **Quote Document** exists only for a Published Revision. Any Published Revision of the Quote can be downloaded.
- A **Draft Preview** is a PDF of the saved Working Draft, visibly marked "BROUILLON". Creating one never publishes the Quote.

## Content

- The PDF contains all the customer-facing content of the on-screen quote document: business and Customer details, reference, issue date, project title, site, validity and contact information, Quote Sections, Quote Lines, long multiline descriptions, quantities, unit prices, fixed prices, section subtotals, Quote Discount, VAT and terms.
- It follows the existing rules. Content is in French and amounts are in CHF. Quote Lines are numbered consecutively and section headings are not numbered. Fixed-price lines get no quantity or unit price. Unregistered Quotes have no VAT row.
- Published Revisions use their stored calculated amounts and never recalculate them.
- The revision number appears in the document only from revision 2 onward. The filename always includes it, for example `Devis-2026-014-r2.pdf`. A Draft Preview uses a name like `Devis-2026-014-brouillon.pdf`.
- In a Draft Preview, missing values appear as "à compléter". Totals that cannot be calculated are marked incomplete, never shown as CHF 0.00. The preview never invents values.

## Standard layout (Quote Layout `standard`, version 1)

- A4 portrait.
- The Customer address fits a right-hand Swiss window envelope.
- Every page shows the Quote reference and "page X/Y".
- Section headings stay with their first Quote Line across page breaks. Long descriptions can split across pages without text being cut off.
- The text can be selected and searched.
- The optional business logo appears in the header. Without a logo, the business name takes its place.
- The layout has its own markup and styles and does not use the application's shared styles (ADR 0005).

## Quote Layouts and rendering

- PDFs are generated on each download and never stored (ADR 0004).
- Each Published Revision records its Quote Layout and version. Revisions published before this feature use `standard` version 1.
- The first release has only the standard layout, so the interface offers no layout choice. Later, the Quote Layout will be chosen per Quote in the Working Draft, with a business default, and will freeze at Publication.
- Layouts are HTML/CSS, printed to PDF by headless Chromium behind one server-side rendering interface (ADR 0005).

## Logo

- The business logo is optional and set in the business settings. It accepts PNG or JPEG up to 1 MB. SVG is rejected.
- Logos are stored in Postgres. A Published Revision references the exact logo it was published with. Replacing the logo later does not change older revisions. A logo is never deleted while a revision references it.
- A Working Draft uses the business logo as it was copied into that draft, following the same rule as the other copied business details.

## Artisan workflow

- The Working Draft workspace offers a Draft Preview download ("Aperçu PDF"). It waits for any save in progress. It excludes pending assistant proposals and says so: "Les modifications proposées non acceptées ne figurent pas dans l'aperçu."
- Each Published Revision on the Quote page has its own download, with the latest one most prominent.
- The Publication confirmation offers "Télécharger le devis" directly.
- On a phone, the download goes through the browser's normal handling, which opens the system share or open sheet.

## Acceptance

- Every anonymized example in `docs/examples/first-quotes/` renders as a Quote Document and as a Draft Preview:
  - no text is cut off;
  - page headers and numbers are correct;
  - the text can be selected and searched.
- Another Artisan Business cannot download the PDFs.
- Tagged, accessible PDFs (PDF/UA) are out of scope for the first release.

## Agreed test seams

1. The pure Quote Document content module, tested with Vitest.
2. Server-side PDF download for a revision and for a Draft Preview, tested with Vitest against real Postgres and real Chromium. Tests read the text back from the PDF.
3. Business logo validation and freezing, tested through the business-defaults server interface.
4. The Artisan workflow and the example quotes, tested with Playwright.

There are no tests on HTML markup and no visual PDF snapshots.
