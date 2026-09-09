import type { Route } from "./+types/auth.$";

import { getAuth } from "../lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  return getAuth().handler(request);
}

export async function loader({ request }: Route.LoaderArgs) {
  return getAuth().handler(request);
}
