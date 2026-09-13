import nodemailer from "nodemailer";

import type { InterfaceLanguage } from "./auth-config.server";

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
  const message = { from: process.env.SMTP_FROM ?? "auth@voidstation.ch", to: input.to, subject, text, html };

  if (mailMode() === "fake") {
    capturedEmails.push({ to: input.to, subject, text, html });
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
  await transporter.sendMail(message);
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
