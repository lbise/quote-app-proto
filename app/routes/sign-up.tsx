import { data, Form, Link, useActionData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/sign-up";

import { AuthShell, Field, FormMessage } from "../components/auth-shell";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { actionError, callAuthEndpoint } from "../lib/auth-ui.server";

const copy = {
  en: { title: "Create an account", intro: "Easy Quote is currently available to selected testers.", name: "Name", email: "Email", password: "Password (at least 8 characters)", confirmPassword: "Confirm password", passwordMismatch: "Passwords do not match. Please enter the same password twice.", submit: "Create account", existing: "Already have an account? Sign in", error: "We could not create that account. Check your details and access approval." },
  fr: { title: "Créer un compte", intro: "Easy Quote est actuellement disponible pour des testeurs sélectionnés.", name: "Nom", email: "E-mail", password: "Mot de passe (8 caractères minimum)", confirmPassword: "Confirmer le mot de passe", passwordMismatch: "Les mots de passe ne correspondent pas. Saisissez deux fois le même mot de passe.", submit: "Créer le compte", existing: "Vous avez déjà un compte ? Se connecter", error: "Nous n’avons pas pu créer ce compte. Vérifiez vos informations et votre autorisation d’accès." },
} as const;

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale: InterfaceLanguage = form.get("locale") === "en" ? "en" : "fr";
  const password = form.get("password");
  const confirmation = form.get("confirmPassword");
  if (typeof password !== "string" || typeof confirmation !== "string" || !confirmation || password !== confirmation) {
    return data({ error: copy[locale].passwordMismatch }, { status: 400 });
  }

  const response = await callAuthEndpoint(request, "/sign-up/email", {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    password,
    callbackURL: "/verify",
  });
  const error = await actionError(response, copy[locale].error);
  return error ? { error } : new Response(null, { status: 302, headers: { Location: `/verify?email=${encodeURIComponent(String(form.get("email") ?? ""))}` } });
}

export default function SignUp() {
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
        <Form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="locale" value={locale} />
          <Field label={text.name} name="name" autoComplete="name" />
          <Field label={text.email} name="email" type="email" />
          <Field label={text.password} name="password" type="password" autoComplete="new-password" minLength={8} />
          <Field label={text.confirmPassword} name="confirmPassword" type="password" autoComplete="new-password" minLength={8} />
          <FormMessage message={actionData?.error} />
          <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">{text.submit}</button>
        </Form>
        <Link className="text-sm underline underline-offset-4" to="/sign-in">{text.existing}</Link>
      </section>
    </AuthShell>
  );
}
