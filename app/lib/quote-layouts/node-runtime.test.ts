import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

// Vitest resolves Vite-only imports such as `?inline`; the evaluator CLI and
// server load Quote code through plain Node and tsx, which cannot.
it("renders the current Quote Layout with embedded fonts outside Vite", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    const { currentQuoteLayout } = await import("./app/lib/quote-layouts/index.ts");
    const { quoteDocumentContent } = await import("./app/lib/quote-document.ts");
    const { emptyQuote } = await import("./app/lib/quote.ts");
    const { html } = currentQuoteLayout.render(quoteDocumentContent({ kind: "draft", quote: emptyQuote("DEVIS-1") }));
    console.log(JSON.stringify((html.match(/url\\("data:font\\/woff2;base64,[A-Za-z0-9+/=]{1000,}"\\)/g) ?? []).length));
  `], { encoding: "utf8", timeout: 20_000 });
  expect(output.trim()).toBe("2");
}, 30_000);
