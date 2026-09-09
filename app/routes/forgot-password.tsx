import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/forgot-password";

import { AuthShell, Field, FormMessage } from "../components/auth-shell";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { actionError, callAuthEndpoint } from "../lib/auth-ui.server";

const copy = {
  en: { title: "Reset your password", intro: "Enter your email. If an account exists, we will send a reset link.", email: "Email", submit: "Send reset link", sent: "If an account exists for that address, you will receive a reset email shortly.", error: "We could not process that request. Please try again shortly.", back: "Back to sign in" },
  fr: { title: "Réinitialiser votre mot de passe", intro: "Saisissez votre e-mail. Si un compte existe, nous enverrons un lien.", email: "E-mail", submit: "Envoyer le lien", sent: "Si un compte existe pour cette adresse, vous recevrez bientôt un e-mail de réinitialisation.", error: "Nous n’avons pas pu traiter cette demande. Réessayez dans un instant.", back: "Retour à la connexion" },
} as const;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale: InterfaceLanguage = form.get("locale") === "en" ? "en" : "fr";
  const response = await callAuthEndpoint(request, "/request-password-reset", {
    email: String(form.get("email") ?? ""),
    redirectTo: "/reset-password",
  });
  const error = await actionError(response, copy[locale].error);
  return error ? { error } : { sent: true };
}

export default function ForgotPassword() {
  const locale = (useRouteLoaderData("root") as { locale: InterfaceLanguage }).locale;
  const text = copy[locale];
  const actionData = useActionData<typeof action>();
  return (
    <AuthShell locale={locale}>
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
          <p className="text-muted-foreground">{text.intro}</p>
        </header>
        {actionData?.sent ? <p role="status" className="text-sm text-muted-foreground">{text.sent}</p> : null}
        <Form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="locale" value={locale} />
          <Field label={text.email} name="email" type="email" />
          <FormMessage message={actionData?.error} />
          <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">{text.submit}</button>
        </Form>
        <Link className="text-sm underline underline-offset-4" to="/sign-in">{text.back}</Link>
      </section>
    </AuthShell>
  );
}
