import nodemailer from "nodemailer";

import type { InterfaceLanguage } from "./auth-config.server";
import { INVITATION_LIFETIME_DAYS } from "./invitations.server";
import { registrationDisclosure } from "./registration-disclosure";

export type CapturedEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const capturedEmails: CapturedEmail[] = [];

export function clearCapturedEmails(): void {
  capturedEmails.length = 0;
}

export function capturedAuthEmails(): readonly CapturedEmail[] {
  return capturedEmails;
}

function mailMode(): "fake" | "smtp" {
  return process.env.EMAIL_DELIVERY === "smtp" ? "smtp" : "fake";
}

function languageFor(language: InterfaceLanguage, english: string, french: string): string {
  return language === "en" ? english : french;
}

export async function sendAuthEmail(input: {
  to: string;
  url: string;
  kind: "verification" | "reset";
  language: InterfaceLanguage;
}): Promise<void> {
  const subject = languageFor(
    input.language,
    input.kind === "verification" ? "Verify your Easy Quote email" : "Reset your Easy Quote password",
    input.kind === "verification" ? "Vérifiez votre adresse Easy Quote" : "Réinitialisez votre mot de passe Easy Quote",
  );
  const intro = languageFor(
    input.language,
    input.kind === "verification" ? "Verify your email address to access Easy Quote." : "Use this link to choose a new Easy Quote password.",
    input.kind === "verification" ? "Vérifiez votre adresse e-mail pour accéder à Easy Quote." : "Utilisez ce lien pour choisir un nouveau mot de passe Easy Quote.",
  );
  const action = languageFor(input.language, "Open the secure link", "Ouvrir le lien sécurisé");
  const expiry = languageFor(input.language, "This link expires soon. If you did not request it, you can ignore this email.", "Ce lien expire bientôt. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.");
  const text = `${intro}\n\n${input.url}\n\n${expiry}`;
  const html = `<p>${intro}</p><p><a href="${escapeHtml(input.url)}">${action}</a></p><p>${expiry}</p>`;
  await deliver({ to: input.to, subject, text, html });
}

/**
 * An Administrator's invitation to sign up. The invitee's language is not
 * known yet, so the email is in French and English.
 */
export async function sendInvitationEmail(input: { to: string; url: string; administrator: boolean }): Promise<void> {
  const days = INVITATION_LIFETIME_DAYS;
  const parts = {
    fr: {
      intro: input.administrator ? "Vous êtes invité à utiliser Easy Quote en tant qu’administrateur." : "Vous êtes invité à utiliser Easy Quote.",
      action: "Ouvrez ce lien pour créer votre compte et choisir votre mot de passe :",
      link: "Créer mon compte",
      expiry: `Ce lien est valable ${days} jours et ne sert qu’une fois.`,
      ignore: "Si vous ne vous attendiez pas à cette invitation, ignorez cet e-mail.",
    },
    en: {
      intro: input.administrator ? "You are invited to use Easy Quote as an Administrator." : "You are invited to use Easy Quote.",
      action: "Open this link to create your account and choose your password:",
      link: "Create my account",
      expiry: `This link is valid for ${days} days and can be used once.`,
      ignore: "If you did not expect this invitation, you can ignore this email.",
    },
  };
  const text = (["fr", "en"] as const).map((language) => {
    const part = parts[language];
    return `${part.intro}\n\n${part.action}\n${input.url}\n\n${part.expiry}\n\n${registrationDisclosure[language]}\n\n${part.ignore}`;
  }).join("\n\n---\n\n");
  const html = (["fr", "en"] as const).map((language) => {
    const part = parts[language];
    return `<div lang="${language}"><p>${part.intro}</p><p><a href="${escapeHtml(input.url)}">${part.link}</a></p><p>${part.expiry}</p><p>${escapeHtml(registrationDisclosure[language])}</p><p>${part.ignore}</p></div>`;
  }).join("<hr>");
  await deliver({ to: input.to, subject: "Invitation à Easy Quote / Your invitation to Easy Quote", text, html });
}

async function deliver(message: CapturedEmail): Promise<void> {
  if (mailMode() === "fake") {
    capturedEmails.push(message);
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass || !process.env.SMTP_FROM) {
    throw new Error("SMTP configuration is incomplete.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
  });
  await transporter.sendMail({ from: process.env.SMTP_FROM, ...message });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
