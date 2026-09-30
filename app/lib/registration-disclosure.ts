/**
 * What a person is told before becoming a User, on the sign-up page (ADR
 * 0007). The invitation email does not carry it: the Administrator writes that
 * email, starting from a default text without it (`invitation-email.ts`).
 */
export const registrationDisclosure = {
  fr: "Les administrateurs d’Easy Quote peuvent lire vos devis et vos conversations avec l’assistant. Pour chaque message à l’assistant, Easy Quote garde une trace de ce qui a été envoyé au modèle d’IA et de sa réponse. Seuls les administrateurs peuvent lire ces traces, conservées 30 jours au plus.",
  en: "Easy Quote Administrators can read your Quotes and your conversations with the assistant. For each message to the assistant, Easy Quote keeps a trace of what was sent to the AI model and what it returned. Only Administrators can read these traces, and they are kept for up to 30 days.",
} as const;
