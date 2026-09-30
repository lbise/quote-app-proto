import { redirect } from "react-router";
import type { Route } from "./+types/home";

import { hasApprovedAccess } from "../lib/auth-config.server";
import { getSession, requireApprovedArtisan } from "../lib/auth.server";
import { signOut } from "../lib/auth-ui.server";

/** The application starts at the Quotes list; the checks send everyone else where they can continue. */
export async function loader({ request }: Route.LoaderArgs) {
  const current = await getSession(request);
  if (!current) throw redirect("/sign-in");
  if (!current.user.emailVerified) throw redirect(`/verify?email=${encodeURIComponent(current.user.email)}`);
  if (!hasApprovedAccess(current.user)) throw redirect("/sign-in?error=not-approved");
  await requireApprovedArtisan(request);
  throw redirect("/quotes");
}

/** Sign-out forms posted here before /sign-out existed keep working. */
export async function action({ request }: Route.ActionArgs) {
  return signOut(request);
}

export default function Home() {
  return null;
}
