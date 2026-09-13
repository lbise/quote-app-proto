import { createQuoteHandler } from "../lib/quotes.server";

const handler = createQuoteHandler();

export async function loader({ request }: { request: Request }) {
  return handler(request);
}

export async function action({ request }: { request: Request }) {
  return handler(request);
}
