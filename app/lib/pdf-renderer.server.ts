import { chromium, type Browser } from "playwright-core";

/** A self-contained HTML page and the page furniture Chromium prints around it. */
export type PrintablePage = {
  html: string;
  /** Chromium templates; `pageNumber` and `totalPages` classes receive the page counters. */
  headerTemplate: string;
  footerTemplate: string;
  margin: { top: string; right: string; bottom: string; left: string };
};

export type PdfRenderer = {
  render(page: PrintablePage): Promise<Uint8Array>;
  close(): Promise<void>;
};

const RENDER_TIMEOUT_MS = 20_000;

/**
 * Prints HTML to PDF with headless Chromium (ADR 0005). One browser is shared
 * and renders are limited so a burst of downloads cannot exhaust memory.
 */
export function createPdfRenderer({ concurrency = 2 }: { concurrency?: number } = {}): PdfRenderer {
  let browser: Promise<Browser> | undefined;
  let active = 0;
  const waiting: (() => void)[] = [];

  function connectedBrowser(): Promise<Browser> {
    if (!browser) {
      const launching = chromium.launch({ headless: true });
      browser = launching;
      launching.then((instance) => instance.on("disconnected", () => { if (browser === launching) browser = undefined; }))
        .catch(() => { if (browser === launching) browser = undefined; });
    }
    return browser;
  }

  async function slot(): Promise<() => void> {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    return () => { active -= 1; waiting.shift()?.(); };
  }

  return {
    async render(printable) {
      const release = await slot();
      const context = await (await connectedBrowser()).newContext({ javaScriptEnabled: false });
      try {
        context.setDefaultTimeout(RENDER_TIMEOUT_MS);
        // Layouts embed every resource. Refuse anything that would reach the network or the file system.
        await context.route((url) => !url.protocol.startsWith("data"), (route) => route.abort());
        const page = await context.newPage();
        await page.setContent(printable.html, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        return new Uint8Array(await page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: printable.headerTemplate,
          footerTemplate: printable.footerTemplate,
          margin: printable.margin,
        }));
      } finally {
        await context.close().catch(() => undefined);
        release();
      }
    },
    async close() {
      const current = browser;
      browser = undefined;
      if (current) await (await current.catch(() => undefined))?.close();
    },
  };
}

let shared: PdfRenderer | undefined;

export function getPdfRenderer(): PdfRenderer {
  shared ??= createPdfRenderer();
  return shared;
}
