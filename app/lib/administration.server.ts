import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { isAdministrator, isBootstrapAdministrator, normalizeEmail, type SessionIdentity } from "./auth-config.server";
import { getAuth } from "./auth.server";
import type { Database } from "./db.server";
import {
  administratorAction,
  artisanBusiness,
  businessDefaults,
  invitation,
  session,
  user,
  type AdministratorActionKind,
  type UserActionKind,
  type UserStatus,
} from "./db/schema";
import {
  defaultInvitationMessage,
  defaultInvitationSubject,
  INVITATION_MESSAGE_MAX_LENGTH,
  INVITATION_SUBJECT_MAX_LENGTH,
  normalizeInvitationText,
} from "./invitation-email";
import { invitationUrl, newInvitationToken } from "./invitations.server";
import { sendInvitationEmail } from "./mail.server";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** How a User is an Administrator: not at all, granted in the admin area, or a Bootstrap Administrator listed in ADMIN_EMAILS. */
export type AdministratorRole = "none" | "granted" | "bootstrap";

export type AdministeredUser = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  administrator: AdministratorRole;
  business: { id: string; name: string } | null;
  createdAt: Date;
};

export type AdministratorActionRecord = {
  id: string;
  actorEmail: string;
  targetEmail: string;
  action: AdministratorActionKind;
  createdAt: Date;
};

/** An invitation not yet accepted. It expires 7 days after it was last sent. */
export type InvitationState = "pending" | "expired" | "cancelled";

export type AdministeredInvitation = {
  id: string;
  email: string;
  state: InvitationState;
  /** Whether the invitee becomes an Administrator when they sign up. */
  administrator: boolean;
  invitedByEmail: string;
  sentAt: Date;
  expiresAt: Date;
};

export type RefusalCode =
  | "not_administrator"
  | "user_not_found"
  | "self"
  | "bootstrap_administrator"
  | "last_administrator"
  | "invalid_email"
  | "invalid_email_subject"
  | "invalid_email_message"
  | "user_exists"
  | "already_invited"
  | "invitation_not_found"
  | "invitation_accepted"
  | "email_not_sent";

/** An administrator action refused by a safeguard. Nothing was changed or recorded. */
export class AdministrationRefusal extends Error {
  constructor(readonly code: RefusalCode) { super(code); }
}

function roleOf(entry: { email: string; administrator: boolean }): AdministratorRole {
  if (isBootstrapAdministrator(entry.email)) return "bootstrap";
  return entry.administrator ? "granted" : "none";
}

/** Every User, oldest first, with their Artisan Business. */
export async function listUsers(database: Database): Promise<AdministeredUser[]> {
  const rows = await database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      administrator: user.administrator,
      createdAt: user.createdAt,
      businessId: artisanBusiness.id,
      defaults: businessDefaults.defaults,
    })
    .from(user)
    .leftJoin(artisanBusiness, eq(artisanBusiness.ownerUserId, user.id))
    .leftJoin(businessDefaults, eq(businessDefaults.businessId, artisanBusiness.id))
    .orderBy(asc(user.createdAt), asc(user.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    administrator: roleOf(row),
    business: row.businessId ? { id: row.businessId, name: businessName(row.defaults) } : null,
    createdAt: row.createdAt,
  }));
}

/** An Artisan Business's name, from its saved business defaults; empty when it has none. */
export function businessName(defaults: unknown): string {
  const name = (defaults as { businessName?: unknown } | null)?.businessName;
  return typeof name === "string" ? name.trim() : "";
}

/** Every recorded administrator action, newest first. */
export async function listAdministratorActions(database: Database): Promise<AdministratorActionRecord[]> {
  return database
    .select({
      id: administratorAction.id,
      actorEmail: administratorAction.actorEmail,
      targetEmail: administratorAction.targetEmail,
      action: administratorAction.action,
      createdAt: administratorAction.createdAt,
    })
    .from(administratorAction)
    .orderBy(desc(administratorAction.createdAt), desc(administratorAction.id));
}

/**
 * Block, unblock, grant or remove the Administrator role, and record who did
 * it. Blocking ends every session of the User at once; an Assistant Turn
 * already running is left to finish. The User's business records are untouched.
 * Returns false, recording nothing, when the User is already in that state.
 */
export async function applyAdministratorAction(
  database: Database,
  input: { actorUserId: string; targetUserId: string; action: UserActionKind },
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const actor = await lockAsAdministrator(transaction, input.actorUserId);
    const target = await findUser(transaction, input.targetUserId);
    if (!target) throw new AdministrationRefusal("user_not_found");

    const changed = await changeUser(transaction, input.action, actor, target);
    if (!changed) return false;
    await record(transaction, actor, input.action, target);
    return true;
  });
}

type UserRow = typeof user.$inferSelect;

async function changeUser(transaction: Transaction, action: UserActionKind, actor: UserRow, target: UserRow): Promise<boolean> {
  const update = (values: Partial<Pick<UserRow, "status" | "administrator">>) =>
    transaction.update(user).set({ ...values, updatedAt: new Date() }).where(eq(user.id, target.id));
  const role = roleOf(target);

  if (action === "unblock") {
    if (target.status !== "blocked") return false;
    await update({ status: "active" });
    return true;
  }
  if (action === "grant_administrator") {
    // A Bootstrap Administrator already has the role; storing it would keep
    // them an Administrator after they leave ADMIN_EMAILS.
    if (role !== "none") return false;
    await update({ administrator: true });
    return true;
  }

  // Blocking and removing the role take Administrator access away.
  if (target.id === actor.id) throw new AdministrationRefusal("self");
  if (role === "bootstrap") throw new AdministrationRefusal("bootstrap_administrator");
  if (action === "block" ? target.status === "blocked" : role === "none") return false;
  if (role === "granted" && target.status === "active" && !(await otherActiveGrantedAdministrator(transaction, target.id))) {
    throw new AdministrationRefusal("last_administrator");
  }
  if (action === "block") {
    await update({ status: "blocked" });
    await transaction.delete(session).where(eq(session.userId, target.id));
  } else {
    await update({ administrator: false });
  }
  return true;
}

async function otherActiveGrantedAdministrator(transaction: Transaction, exceptUserId: string): Promise<boolean> {
  const others = await transaction
    .select({ email: user.email, administrator: user.administrator })
    .from(user)
    .where(and(eq(user.administrator, true), eq(user.status, "active"), ne(user.id, exceptUserId)));
  return others.some((other) => roleOf(other) === "granted");
}

/**
 * Refuse anyone who is not an Administrator now, for reads of other
 * businesses' records. The admin area checks the session first; this checks
 * the stored User again at the data boundary.
 */
export async function assertAdministrator(database: Database, userId: string): Promise<void> {
  const [viewer] = await database.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!viewer || !isAdministrator(viewer)) throw new AdministrationRefusal("not_administrator");
}

/**
 * Serialise administrator changes, so two Administrators cannot each remove
 * the other and leave no granted Administrator, and return the acting
 * Administrator.
 */
async function lockAsAdministrator(transaction: Transaction, actorUserId: string): Promise<UserRow> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('administrator_action'))`);
  const actor = await findUser(transaction, actorUserId);
  if (!actor || !isAdministrator(actor)) throw new AdministrationRefusal("not_administrator");
  return actor;
}

async function record(transaction: Transaction, actor: UserRow, action: AdministratorActionKind, target: { id: string | null; email: string }) {
  await transaction.insert(administratorAction).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    actorEmail: actor.email,
    targetUserId: target.id,
    targetEmail: target.email,
    action,
  });
}

function invitationState(entry: { cancelledAt: Date | null; expiresAt: Date }, now = new Date()): InvitationState {
  if (entry.cancelledAt) return "cancelled";
  return entry.expiresAt.getTime() > now.getTime() ? "pending" : "expired";
}

/**
 * Every invitation not yet accepted, newest first. An invitation whose email
 * now belongs to a User is not listed: that User is.
 */
export async function listInvitations(database: Database): Promise<AdministeredInvitation[]> {
  const rows = await database
    .select({
      id: invitation.id,
      email: invitation.email,
      administrator: invitation.administrator,
      invitedByEmail: invitation.invitedByEmail,
      sentAt: invitation.sentAt,
      expiresAt: invitation.expiresAt,
      cancelledAt: invitation.cancelledAt,
    })
    .from(invitation)
    .leftJoin(user, eq(user.email, invitation.email))
    .where(and(isNull(invitation.acceptedAt), isNull(user.id)))
    .orderBy(desc(invitation.sentAt), desc(invitation.id));
  const now = new Date();
  return rows.map(({ cancelledAt, ...row }) => ({ ...row, state: invitationState({ cancelledAt, expiresAt: row.expiresAt }, now) }));
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The subject the Administrator wrote: one line of 1 to 200 characters. */
function invitationSubject(value: string | undefined): string | null {
  if (value === undefined) return null;
  const subject = value.trim();
  if (!subject || subject.length > INVITATION_SUBJECT_MAX_LENGTH || /[\r\n]/.test(subject)) throw new AdministrationRefusal("invalid_email_subject");
  return subject;
}

/** The message the Administrator wrote: 1 to 5000 characters. */
function invitationMessage(value: string | undefined): string | null {
  if (value === undefined) return null;
  const message = normalizeInvitationText(value);
  if (!message || message.length > INVITATION_MESSAGE_MAX_LENGTH) throw new AdministrationRefusal("invalid_email_message");
  return message;
}

/**
 * Invite an email to sign up, optionally as an Administrator, and email the
 * invitee their link with the subject and message the Administrator wrote.
 * A subject or message left out is the default one. An email with an expired
 * or cancelled invitation is invited again with a new link and the new text.
 * Nothing is saved or recorded if the email cannot be sent.
 */
export async function sendInvitation(
  database: Database,
  input: { actorUserId: string; email: string; administrator: boolean; subject?: string; message?: string },
): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!emailPattern.test(email) || email.length > 254) throw new AdministrationRefusal("invalid_email");
  const emailSubject = invitationSubject(input.subject);
  const emailMessage = invitationMessage(input.message);
  await database.transaction(async (transaction) => {
    const actor = await lockAsAdministrator(transaction, input.actorUserId);
    const [existingUser] = await transaction.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (existingUser) throw new AdministrationRefusal("user_exists");
    const [existing] = await transaction.select().from(invitation).where(eq(invitation.email, email)).limit(1);
    if (existing && !existing.acceptedAt && invitationState(existing) === "pending") throw new AdministrationRefusal("already_invited");

    const now = new Date();
    const { token, tokenHash, expiresAt } = newInvitationToken(now);
    const values = {
      tokenHash,
      administrator: input.administrator,
      invitedByUserId: actor.id,
      invitedByEmail: actor.email,
      sentAt: now,
      expiresAt,
      cancelledAt: null,
      acceptedAt: null,
      acceptedUserId: null,
      emailSubject,
      emailMessage,
    };
    // An accepted invitation whose User was since deleted is replaced too.
    if (existing) await transaction.update(invitation).set(values).where(eq(invitation.id, existing.id));
    else await transaction.insert(invitation).values({ id: crypto.randomUUID(), email, ...values });
    await record(transaction, actor, input.administrator ? "send_administrator_invitation" : "send_invitation", { id: null, email });
    await emailInvitation({ email, token, administrator: input.administrator, emailSubject, emailMessage });
  });
}

/**
 * Send an invitation again with a new link valid for 7 days and the same
 * subject and message. The previous link stops working.
 */
export async function resendInvitation(database: Database, input: { actorUserId: string; invitationId: string }): Promise<void> {
  await database.transaction(async (transaction) => {
    const actor = await lockAsAdministrator(transaction, input.actorUserId);
    const existing = await openInvitation(transaction, input.invitationId);
    const now = new Date();
    const { token, tokenHash, expiresAt } = newInvitationToken(now);
    await transaction.update(invitation).set({ tokenHash, sentAt: now, expiresAt, cancelledAt: null }).where(eq(invitation.id, existing.id));
    await record(transaction, actor, "resend_invitation", { id: null, email: existing.email });
    await emailInvitation({ ...existing, token });
  });
}

/**
 * Cancel an invitation, so its link stops working. It stays listed as
 * cancelled and can be sent again. Returns false, recording nothing, when it
 * is already cancelled.
 */
export async function cancelInvitation(database: Database, input: { actorUserId: string; invitationId: string }): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const actor = await lockAsAdministrator(transaction, input.actorUserId);
    const existing = await openInvitation(transaction, input.invitationId);
    if (existing.cancelledAt) return false;
    await transaction.update(invitation).set({ cancelledAt: new Date() }).where(eq(invitation.id, existing.id));
    await record(transaction, actor, "cancel_invitation", { id: null, email: existing.email });
    return true;
  });
}

/**
 * Send the invitation email with its stored text, or the default text for its
 * role; a failure rolls the invitation back.
 */
async function emailInvitation(entry: {
  email: string;
  token: string;
  administrator: boolean;
  emailSubject: string | null;
  emailMessage: string | null;
}) {
  try {
    await sendInvitationEmail({
      to: entry.email,
      url: invitationUrl(entry.token),
      subject: entry.emailSubject ?? defaultInvitationSubject,
      message: entry.emailMessage ?? defaultInvitationMessage(entry.administrator),
    });
  } catch (error) {
    console.error("Invitation email could not be sent.", error instanceof Error ? error.message : error);
    throw new AdministrationRefusal("email_not_sent");
  }
}

/** An invitation that has not been accepted: its email does not belong to a User. */
async function openInvitation(transaction: Transaction, id: string) {
  const [existing] = await transaction.select().from(invitation).where(eq(invitation.id, id)).limit(1);
  if (!existing) throw new AdministrationRefusal("invitation_not_found");
  const [invitee] = await transaction.select({ id: user.id }).from(user).where(eq(user.email, existing.email)).limit(1);
  if (existing.acceptedAt || invitee) throw new AdministrationRefusal("invitation_accepted");
  return existing;
}

async function findUser(transaction: Transaction, id: string) {
  const [found] = await transaction.select().from(user).where(eq(user.id, id)).limit(1);
  return found;
}

type AdministratorSessionAuth = {
  api: { getSession(input: { headers: Headers }): Promise<{ user: SessionIdentity & { id: string } } | null> };
};

/**
 * The signed-in Administrator, for the admin area. Everyone else, signed in or
 * not, gets a not-found response so the area's existence is not revealed.
 */
export async function requireAdministrator(
  request: Request,
  auth: AdministratorSessionAuth = getAuth(),
): Promise<{ id: string; email: string }> {
  const current = await auth.api.getSession({ headers: request.headers });
  if (!current || !isAdministrator(current.user)) throw new Response("Not Found", { status: 404 });
  return { id: current.user.id, email: current.user.email };
}
