import { redirect } from "react-router";
import type { Route } from "./+types/sign-out";

import { signOut } from "../lib/auth-ui.server";

export async function action({ request }: Route.ActionArgs) {
  return signOut(request);
}

/** Signing out needs a POST; a visit goes to the application. */
export function loader() {
  return redirect("/");
}
