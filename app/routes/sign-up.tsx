import { data, Form, Link, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/sign-up";

import { AuthShell, Field, FormMessage } from "../components/auth-shell";
import type { InterfaceLanguage } from "../lib/auth-config.server";
import { actionError, callAuthEndpoint, isInvitationRequiredResponse } from "../lib/auth-ui.server";
import { getDatabase } from "../lib/db.server";
import { signUpPage } from "../lib/invitations.server";
import { registrationDisclosure } from "../lib/registration-disclosure";

const copy = {
  en: {
    title: "Create an account",
    intro: "Create your Easy Quote account. We will email you a link to verify your address.",
    invitedIntro: "You have been invited to Easy Quote. Choose your name and password to create your account.",
    invitationOnlyTitle: "Easy Quote is invitation-only",
    invitationOnly: "You can create an account only through an invitation link from an Easy Quote Administrator. If you were invited, open the link in your invitation email.",
    invalidTitle: "This invitation link can no longer be used",
    invalid: "It may have expired, been cancelled, been replaced by a newer invitation or already been used. Ask the person who invited you to send it again.",
    openInstead: "Create an account without an invitation",
    name: "Name",
    email: "Email",
    emailLocked: "Your invitation was sent to this address.",
    password: "Password (at least 8 characters)",
    confirmPassword: "Confirm password",
    passwordMismatch: "Passwords do not match. Please enter the same password twice.",
    submit: "Create account",
    existing: "Already have an account? Sign in",
    error: "We could not create that account. Check your details and try again.",
    invitationError: "This invitation link can no longer be used. Ask the person who invited you to send it again.",
  },
  fr: {
    title: "Créer un compte",
    intro: "Créez votre compte Easy Quote. Nous vous enverrons un lien par e-mail pour vérifier votre adresse.",
    invitedIntro: "Vous êtes invité à utiliser Easy Quote. Choisissez votre nom et votre mot de passe pour créer votre compte.",
    invitationOnlyTitle: "Easy Quote est sur invitation",
    invitationOnly: "Vous ne pouvez créer un compte qu’avec un lien d’invitation envoyé par un administrateur d’Easy Quote. Si vous avez été invité, ouvrez le lien de votre e-mail d’invitation.",
    invalidTitle: "Ce lien d’invitation n’est plus utilisable",
    invalid: "Il a peut-être expiré, été annulé, été remplacé par une nouvelle invitation ou déjà servi. Demandez à la personne qui vous a invité de vous le renvoyer.",
    openInstead: "Créer un compte sans invitation",
    name: "Nom",
    email: "E-mail",
    emailLocked: "Votre invitation a été envoyée à cette adresse.",
    password: "Mot de passe (8 caractères minimum)",
    confirmPassword: "Confirmer le mot de passe",
    passwordMismatch: "Les mots de passe ne correspondent pas. Saisissez deux fois le même mot de passe.",
    submit: "Créer le compte",
    existing: "Vous avez déjà un compte ? Se connecter",
    error: "Nous n’avons pas pu créer ce compte. Vérifiez vos informations et réessayez.",
    invitationError: "Ce lien d’invitation n’est plus utilisable. Demandez à la personne qui vous a invité de vous le renvoyer.",
  },
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  return signUpPage(getDatabase(), new URL(request.url).searchParams.get("invitation"));
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const locale: InterfaceLanguage = form.get("locale") === "en" ? "en" : "fr";
  const password = form.get("password");
  const confirmation = form.get("confirmPassword");
  if (typeof password !== "string" || typeof confirmation !== "string" || !confirmation || password !== confirmation) {
    return data({ error: copy[locale].passwordMismatch }, { status: 400 });
  }

  const email = String(form.get("email") ?? "");
  const invitationToken = form.get("invitation");
  // Better Auth checks the invitation; the locked email field is not a control.
  const response = await callAuthEndpoint(request, "/sign-up/email", {
    name: String(form.get("name") ?? ""),
    email,
    password,
    callbackURL: "/verify",
    ...(typeof invitationToken === "string" && invitationToken ? { invitationToken } : {}),
  });
  if (await isInvitationRequiredResponse(response)) return data({ error: copy[locale].invitationError }, { status: 403 });
  const error = await actionError(response, copy[locale].error);
  return error ? { error } : new Response(null, { status: 302, headers: { Location: `/verify?email=${encodeURIComponent(email)}` } });
}

export default function SignUp() {
  const locale = (useRouteLoaderData("root") as { locale: InterfaceLanguage }).locale;
  const text = copy[locale];
  const page = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (page.form === "closed") {
    const invalid = page.reason === "invalid_invitation";
    return (
      <AuthShell locale={locale}>
        <section className="eq-auth-card flex flex-col gap-6">
          <header className="eq-auth-heading flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{invalid ? text.invalidTitle : text.invitationOnlyTitle}</h1>
            <p className="text-muted-foreground">{invalid ? text.invalid : text.invitationOnly}</p>
          </header>
          {invalid && page.registration === "open" ? <Link className="text-sm underline underline-offset-4" to="/sign-up">{text.openInstead}</Link> : null}
          <Link className="text-sm underline underline-offset-4" to="/sign-in">{text.existing}</Link>
        </section>
      </AuthShell>
    );
  }

  const invitation = page.form === "invitation" ? page : null;
  return (
    <AuthShell locale={locale}>
      <section className="eq-auth-card flex flex-col gap-6">
        <header className="eq-auth-heading flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
          <p className="text-muted-foreground">{invitation ? text.invitedIntro : text.intro}</p>
        </header>
        <Form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="locale" value={locale} />
          {invitation ? <input type="hidden" name="invitation" value={invitation.token} /> : null}
          <Field label={text.name} name="name" autoComplete="name" />
          {invitation
            ? <Field label={text.email} name="email" type="email" defaultValue={invitation.email} readOnly description={text.emailLocked} />
            : <Field label={text.email} name="email" type="email" />}
          <Field label={text.password} name="password" type="password" autoComplete="new-password" minLength={8} />
          <Field label={text.confirmPassword} name="confirmPassword" type="password" autoComplete="new-password" minLength={8} />
          <p className="text-sm text-muted-foreground">{registrationDisclosure[locale]}</p>
          <FormMessage message={actionData?.error} />
          <button className="eq-auth-submit h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">{text.submit}</button>
        </Form>
        <Link className="text-sm underline underline-offset-4" to="/sign-in">{text.existing}</Link>
      </section>
    </AuthShell>
  );
}
