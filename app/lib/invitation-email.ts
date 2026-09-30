/**
 * The text of the invitation email, which the Administrator writes when
 * sending an invitation. Shared by the invite form, which starts from the
 * default text, and the server, which checks and delivers it.
 */

/** How long an invitation link stays valid after it is sent. */
export const INVITATION_LIFETIME_DAYS = 7;

/** Where the invitation link goes in the message. */
export const INVITATION_LINK_PLACEHOLDER = "{lien}";

export const INVITATION_SUBJECT_MAX_LENGTH = 200;
export const INVITATION_MESSAGE_MAX_LENGTH = 5000;

/** The subject an invitation email has unless the Administrator changes it. */
export const defaultInvitationSubject = "Invitation à Easy Quote / Your invitation to Easy Quote";

/**
 * The message an invitation email has unless the Administrator changes it, in
 * French then English, because the invitee's language is not known yet. The
 * sign-up page, not this message, tells the invitee what Administrators can
 * read.
 */
export function defaultInvitationMessage(administrator: boolean): string {
  const days = INVITATION_LIFETIME_DAYS;
  const link = INVITATION_LINK_PLACEHOLDER;
  const french = [
    administrator ? "Vous êtes invité à utiliser Easy Quote en tant qu’administrateur." : "Vous êtes invité à utiliser Easy Quote.",
    `Ouvrez ce lien pour créer votre compte et choisir votre mot de passe :\n${link}`,
    `Ce lien est valable ${days} jours et ne sert qu’une fois.`,
    "Si vous ne vous attendiez pas à cette invitation, ignorez cet e-mail.",
  ];
  const english = [
    administrator ? "You are invited to use Easy Quote as an Administrator." : "You are invited to use Easy Quote.",
    `Open this link to create your account and choose your password:\n${link}`,
    `This link is valid for ${days} days and can be used once.`,
    "If you did not expect this invitation, you can ignore this email.",
  ];
  return [french.join("\n\n"), "---", english.join("\n\n")].join("\n\n");
}

/** Line endings as a browser submits them, made uniform, and outer blank space removed. */
export function normalizeInvitationText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}
