export function loader() {
  return Response.json(
    { status: "alive" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
