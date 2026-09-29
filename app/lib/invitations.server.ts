import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { authBaseUrl, normalizeEmail, registrationMode, type RegistrationMode } from "./auth-config.server";
import type { Database } from "./db.server";
import { invitation, user } from "./db/schema";

/** How long an invitation link stays valid after it is sent. */
export const INVITATION_LIFETIME_DAYS = 7;

/** A new invitation token, its stored hash, and when it expires. */
export function newInvitationToken(now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The link in the invitation email: the sign-up page, with the email filled in and locked. */
export function invitationUrl(token: string): string {
  return `${authBaseUrl()}/sign-up?invitation=${encodeURIComponent(token)}`;
}

/** An invitation that can still be used: not accepted, cancelled or expired. */
const usable = () => and(isNull(invitation.acceptedAt), isNull(invitation.cancelledAt), gt(invitation.expiresAt, new Date()));

export type UsableInvitation = { email: string; administrator: boolean };

/**
 * The invitation an invitation link opens, while it can still be used to sign
 * up. Null for an unknown, replaced, expired, cancelled or used link, and for
 * an email that already belongs to a User.
 */
export async function invitationForSignUp(database: Database, token: unknown): Promise<UsableInvitation | null> {
  if (typeof token !== "string" || !token || token.length > 200) return null;
  const [found] = await database
    .select({ email: invitation.email, administrator: invitation.administrator, userId: user.id })
    .from(invitation)
    .leftJoin(user, eq(user.email, invitation.email))
    .where(and(eq(invitation.tokenHash, hashInvitationToken(token)), usable()))
    .limit(1);
  return found && !found.userId ? { email: found.email, administrator: found.administrator } : null;
}

/** The usable invitation for an email about to become a User, if there is one. */
export async function usableInvitationForEmail(database: Database, email: string): Promise<UsableInvitation | null> {
  const [found] = await database
    .select({ email: invitation.email, administrator: invitation.administrator })
    .from(invitation)
    .where(and(eq(invitation.email, normalizeEmail(email)), usable()))
    .limit(1);
  return found ?? null;
}

/** Use up the invitation of a new User, so its link stops working. */
export async function acceptInvitation(database: Database, email: string, userId: string): Promise<void> {
  await database
    .update(invitation)
    .set({ acceptedAt: new Date(), acceptedUserId: userId })
    .where(and(eq(invitation.email, normalizeEmail(email)), usable()));
}

/** What the sign-up page offers. */
export type SignUpPage =
  /** Anyone may sign up. */
  | { form: "open" }
  /** An invitation link: the email is filled in and locked. */
  | { form: "invitation"; email: string; token: string }
  /** No form: sign-up needs an invitation, or the link cannot be used. */
  | { form: "closed"; reason: "invitation_only" | "invalid_invitation"; registration: RegistrationMode };

export async function signUpPage(database: Database, token: string | null): Promise<SignUpPage> {
  const registration = registrationMode();
  if (token) {
    const invitation = await invitationForSignUp(database, token);
    return invitation ? { form: "invitation", email: invitation.email, token } : { form: "closed", reason: "invalid_invitation", registration };
  }
  return registration === "open" ? { form: "open" } : { form: "closed", reason: "invitation_only", registration };
}
