import { Form, redirect, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";

import { LanguageSwitch } from "../components/language-switch";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { hasApprovedAccess } from "../lib/auth-config.server";
import { callAuthEndpoint, redirectWithAuthCookies } from "../lib/auth-ui.server";
import { getSession, requireApprovedArtisan } from "../lib/auth.server";

const copy = {
  en: { title: "Your workspace", intro: "Your protected Easy Quote workspace is ready.", signedInAs: "Signed in as", signout: "Sign out" },
  fr: { title: "Votre espace", intro: "Votre espace Easy Quote protégé est prêt.", signedInAs: "Connecté en tant que", signout: "Se déconnecter" },
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const current = await getSession(request);
  if (!current) throw redirect("/sign-in");
  if (!current.user.emailVerified) throw redirect(`/verify?email=${encodeURIComponent(current.user.email)}`);
  if (!hasApprovedAccess(current.user)) throw redirect("/sign-in?error=not-approved");
  const access = await requireApprovedArtisan(request);
  return { email: access.user.email, businessId: access.business.id };
}

export async function action({ request }: Route.ActionArgs) {
  const response = await callAuthEndpoint(request, "/sign-out", {});
  return redirectWithAuthCookies(response, "/sign-in");
}

export default function Home() {
  const locale = (useRouteLoaderData("root") as { locale: InterfaceLanguage }).locale;
  const text = copy[locale];
  const { email } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between border-b pb-6">
        <div>
          <p className="text-sm text-muted-foreground">Easy Quote</p>
          <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
        </div>
        <LanguageSwitch locale={locale} />
      </header>
      <section className="flex flex-col gap-3">
        <p className="text-muted-foreground">{text.intro}</p>
        <p className="text-sm"><span className="font-medium">{text.signedInAs}:</span> {email}</p>
      </section>
      <Form method="post">
        <button className="rounded-md border px-4 py-2 text-sm font-medium" type="submit">{text.signout}</button>
      </Form>
    </main>
  );
}
