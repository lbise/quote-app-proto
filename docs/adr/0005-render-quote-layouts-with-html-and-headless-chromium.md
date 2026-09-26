# Render Quote Layouts with HTML/CSS and headless Chromium

Each Quote Layout is an HTML/CSS document filled with the Quote's content, and headless Chromium prints it to PDF. The team already works in HTML/CSS and already uses Playwright for browser tests. Easy Quote will offer a few prepared Quote Layouts, with options to hide some items. Artisans will not design their own layouts. That removes the main reason to choose a more specialized engine.

## Considered options

- **Typst.** Typst handles pagination and typography better and is much lighter. However, every Quote Layout would require a language the team does not know.
- **JavaScript PDF libraries (`@react-pdf/renderer`, pdfmake).** These are light, but their limited layout models make polished multi-page quotes harder.
- **WeasyPrint or Prince.** Both have better print CSS support, but WeasyPrint adds a Python runtime and Prince requires a licence.
- **Hosted PDF APIs.** These send customer data to another processor.

## Consequences

- Each Quote Layout version has its own markup and styles, so it cannot change when shared application styles change. This keeps ADR 0004's promise that older revisions keep their appearance.
- Chromium makes the deployed image larger and each PDF render heavier. Rendering stays behind one server-side interface. Under ADR 0001 it starts inside the application, and it can later move to a separate rendering service without changing Quote Layouts. We do not assume the current VPS hosting is permanent.
- Chromium supports repeated headers, page counters and keeping headings with the next line less completely than a typesetting engine. The standard layout needs tests on long multi-page examples.
