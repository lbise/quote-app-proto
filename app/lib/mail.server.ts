import nodemailer from "nodemailer";

import type { InterfaceLanguage } from "./auth-config.server";
import { INVITATION_LINK_PLACEHOLDER } from "./invitation-email";

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
 * An Administrator's invitation to sign up, with the subject and message the
 * Administrator wrote. Each {lien} in the message becomes the invitation link;
 * a message without one gets the link at the end.
 */
export async function sendInvitationEmail(input: { to: string; url: string; subject: string; message: string }): Promise<void> {
  await deliver({ to: input.to, ...invitationEmailContent(input) });
}

/** The invitation email's subject, text and HTML, with the link in place. */
export function invitationEmailContent(input: { url: string; subject: string; message: string }): Omit<CapturedEmail, "to"> {
  const message = input.message.includes(INVITATION_LINK_PLACEHOLDER)
    ? input.message.split(INVITATION_LINK_PLACEHOLDER).join(input.url)
    : `${input.message}\n\n${input.url}`;
  return { subject: input.subject, text: message, html: invitationHtml(message, input.url) };
}

/**
 * Plain text as HTML: blank lines separate paragraphs, other line breaks are
 * kept, a line of "---" is a rule, and the link can be clicked.
 */
function invitationHtml(text: string, url: string): string {
  const link = `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  const line = (value: string) => value.split(url).map(escapeHtml).join(link);
  const html: string[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    let paragraph: string[] = [];
    const close = () => {
      if (paragraph.length) html.push(`<p>${paragraph.join("<br>")}</p>`);
      paragraph = [];
    };
    for (const row of block.split("\n")) {
      if (row.trim() === "---") {
        close();
        html.push("<hr>");
      } else if (row.trim()) {
        paragraph.push(line(row));
      }
    }
    close();
  }
  return html.join("");
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
