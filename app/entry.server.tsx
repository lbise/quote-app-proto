import { PassThrough } from "node:stream";

import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";

import { assertQuoteAIConfiguration } from "./lib/quote-ai-config.server";

// Validate enabled outbound processing when the server module initializes, not
// when an Artisan first sends a message.
assertQuoteAIConfiguration();

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const readyOption: keyof RenderToPipeableStreamOptions =
      (request.headers.get("user-agent") && isbot(request.headers.get("user-agent")!)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1_000);

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        },
        onShellError() {
          clearTimeout(timeoutId);
          reject(new Error("The application could not render this request."));
        },
        onError() {
          responseStatusCode = 500;
          if (shellRendered) console.error("The application could not render this request.");
        },
      },
    );
  });
}
