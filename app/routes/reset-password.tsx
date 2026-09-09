import { Form, Link, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/reset-password";

import { AuthShell, Field, FormMessage } from "../components/auth-shell";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { actionError, callAuthEndpoint } from "../lib/auth-ui.server";

const copy = {
  en: { title: "Choose a new password", intro: "Choose a new password for your Easy Quote account.", password: "New password (at least 8 characters)", submit: "Update password", done: "Your password was updated. All previous sessions have been signed out.", error: "This reset link is invalid, expired, or already used.", signin: "Sign in" },
  fr: { title: "Choisir un nouveau mot de passe", intro: "Choisissez un nouveau mot de passe pour votre compte Easy Quote.", password: "Nouveau mot de passe (8 caractères minimum)", submit: "Modifier le mot de passe", done: "Votre mot de passe a été modifié. Toutes les sessions précédentes ont été déconnectées.", error: "Ce lien de réinitialisation est invalide, expiré ou déjà utilisé.", signin: "Se connecter" },
} as const;

export function loader({ request }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  return { token: search.get("token") ?? "", invalidLink: Boolean(search.get("error")) };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale: InterfaceLanguage = form.get("locale") === "en" ? "en" : "fr";
  const response = await callAuthEndpoint(request, "/reset-password", {
    token: String(form.get("token") ?? ""),
    newPassword: String(form.get("password") ?? ""),
  });
  const error = await actionError(response, copy[locale].error);
  return error ? { error } : { done: true };
}

export default function ResetPassword() {
  const locale = (useRouteLoaderData("root") as { locale: InterfaceLanguage }).locale;
  const text = copy[locale];
  const { token, invalidLink } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <AuthShell locale={locale}>
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
          <p className="text-muted-foreground">{text.intro}</p>
        </header>
        {invalidLink ? <p role="alert" className="text-sm text-destructive">{text.error}</p> : null}
        {actionData?.done ? <><p role="status" className="text-sm text-muted-foreground">{text.done}</p><Link className="text-sm underline" to="/sign-in">{text.signin}</Link></> : (
          <Form method="post" className="flex flex-col gap-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <Field label={text.password} name="password" type="password" autoComplete="new-password" minLength={8} />
            <FormMessage message={actionData?.error} />
            <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">{text.submit}</button>
          </Form>
        )}
      </section>
    </AuthShell>
  );
}
