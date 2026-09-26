import { createBusinessLogoHandler } from "../lib/business-logo.server";

const handler = createBusinessLogoHandler();

export async function loader({ request }: { request: Request }) {
  return handler(request);
}

export async function action({ request }: { request: Request }) {
  return handler(request);
}
