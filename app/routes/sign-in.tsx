import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/sign-in";

import { AuthShell, Field, FormMessage } from "../components/auth-shell";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { actionError, callAuthEndpoint, isBlockedResponse, redirectWithAuthCookies } from "../lib/auth-ui.server";

const copy = {
  en: { title: "Sign in", intro: "Sign in to prepare customer quotes.", submit: "Sign in", signup: "Create an account", forgot: "Forgot your password?", error: "The email or password is incorrect, or your email still needs verification.", blocked: "Your access to Easy Quote has been blocked. Contact the Easy Quote team if you think this is a mistake.", email: "Email", password: "Password" },
  fr: { title: "Se connecter", intro: "Connectez-vous pour préparer vos devis clients.", submit: "Se connecter", signup: "Créer un compte", forgot: "Mot de passe oublié ?", error: "L’e-mail ou le mot de passe est incorrect, ou votre adresse doit encore être vérifiée.", blocked: "Votre accès à Easy Quote a été bloqué. Contactez l’équipe Easy Quote si vous pensez qu’il s’agit d’une erreur.", email: "E-mail", password: "Mot de passe" },
} as const;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale: InterfaceLanguage = form.get("locale") === "en" ? "en" : "fr";
  const response = await callAuthEndpoint(request, "/sign-in/email", {
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    callbackURL: "/",
  });
  // Only reached with the correct password, so it does not reveal whether an email is registered.
  if (await isBlockedResponse(response)) return { error: copy[locale].blocked };
  const error = await actionError(response, copy[locale].error);
  return error ? { error } : redirectWithAuthCookies(response, "/");
}

export default function SignIn() {
  const locale = (useRouteLoaderData("root") as { locale: InterfaceLanguage }).locale;
  const text = copy[locale];
  const actionData = useActionData<typeof action>();
  return (
    <AuthShell locale={locale}>
      <section className="eq-auth-card flex flex-col gap-6">
        <header className="eq-auth-heading flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
          <p className="text-muted-foreground">{text.intro}</p>
        </header>
        <Form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="locale" value={locale} />
          <Field label={text.email} name="email" type="email" />
          <Field label={text.password} name="password" type="password" />
          <FormMessage message={actionData?.error} />
          <button className="eq-auth-submit h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">{text.submit}</button>
        </Form>
        <nav className="eq-auth-links flex flex-col gap-2 text-sm">
          <Link className="underline underline-offset-4" to="/forgot-password">{text.forgot}</Link>
          <Link className="underline underline-offset-4" to="/sign-up">{text.signup}</Link>
        </nav>
      </section>
    </AuthShell>
  );
}
