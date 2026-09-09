import { Form, Link, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/verify";

import { AuthShell, Field, FormMessage } from "../components/auth-shell";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { actionError, callAuthEndpoint } from "../lib/auth-ui.server";

const copy = {
  en: { title: "Check your email", intro: "Open the verification link we sent before signing in.", email: "Email", resend: "Resend verification email", sent: "If the address is eligible, a new verification email has been sent.", error: "That verification link is invalid or expired. Request a new one below.", sendError: "We could not send the email. Please try again shortly.", back: "Back to sign in" },
  fr: { title: "Vérifiez votre e-mail", intro: "Ouvrez le lien de vérification envoyé avant de vous connecter.", email: "E-mail", resend: "Renvoyer l’e-mail de vérification", sent: "Si cette adresse est autorisée, un nouvel e-mail de vérification a été envoyé.", error: "Ce lien de vérification est invalide ou expiré. Demandez-en un nouveau ci-dessous.", sendError: "Nous n’avons pas pu envoyer l’e-mail. Réessayez dans un instant.", back: "Retour à la connexion" },
} as const;

export function loader({ request }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  return {
    email: search.get("email") ?? "",
    invalidLink: Boolean(search.get("error")),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale: InterfaceLanguage = form.get("locale") === "en" ? "en" : "fr";
  const response = await callAuthEndpoint(request, "/send-verification-email", {
    email: String(form.get("email") ?? ""),
    callbackURL: "/sign-in",
  });
  const error = await actionError(response, copy[locale].sendError);
  return error ? { error } : { sent: true };
}

export default function Verify() {
  const locale = (useRouteLoaderData("root") as { locale: InterfaceLanguage }).locale;
  const text = copy[locale];
  const { email, invalidLink } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <AuthShell locale={locale}>
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
          <p className="text-muted-foreground">{text.intro}</p>
        </header>
        {invalidLink ? <p role="alert" className="text-sm text-destructive">{text.error}</p> : null}
        {actionData?.sent ? <p role="status" className="text-sm text-muted-foreground">{text.sent}</p> : null}
        <Form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="locale" value={locale} />
          <Field label={text.email} name="email" type="email" required defaultValue={email} />
          <FormMessage message={actionData?.error} />
          <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">{text.resend}</button>
        </Form>
        <Link className="text-sm underline underline-offset-4" to="/sign-in">{text.back}</Link>
      </section>
    </AuthShell>
  );
}
