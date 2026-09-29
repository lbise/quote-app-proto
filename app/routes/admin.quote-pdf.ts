import { createAdministratorQuotePdfHandler } from "../lib/quote-pdf.server";

const handler = createAdministratorQuotePdfHandler();

export async function loader({ request }: { request: Request }) {
  return handler(request);
}
