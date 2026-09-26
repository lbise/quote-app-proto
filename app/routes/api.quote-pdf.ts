import { createQuotePdfHandler } from "../lib/quote-pdf.server";

const handler = createQuotePdfHandler();

export async function loader({ request }: { request: Request }) {
  return handler(request);
}
