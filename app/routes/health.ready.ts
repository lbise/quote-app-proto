import { readiness } from "../lib/health.server";

export async function loader() {
  const result = await readiness();
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
