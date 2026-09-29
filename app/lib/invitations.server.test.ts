import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import {
  AdministrationRefusal,
  cancelInvitation,
  listAdministratorActions,
  listInvitations,
  listUsers,
  resendInvitation,
  sendInvitation,
} from "./administration.server";
import { authBaseUrl } from "./auth-config.server";
import { invitation, user } from "./db/schema";
import { invitationForSignUp, signUpPage } from "./invitations.server";
import { capturedAuthEmails, clearCapturedEmails } from "./mail.server";
import { quoteHttpHarness } from "./quote-http.test-support";

// #51: invite Users and switch between invitation-only and open registration.

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("invitations and registration mode", () => {
  const harness = quoteHttpHarness("invitations");
  const database = harness.connection.db;
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  let administrator: Awaited<ReturnType<typeof harness.artisan>>;

  /** An existing User, signed up while registration is open. */
  async function existingUser(name: string) {
    const mode = process.env.REGISTRATION_MODE;
    process.env.REGISTRATION_MODE = "open";
    try { return await harness.artisan(name); } finally { process.env.REGISTRATION_MODE = mode; }
  }

  beforeAll(async () => {
    harness.setUp();
    administrator = await existingUser("Inviting Administrator");
  });
  beforeEach(() => {
    process.env.ADMIN_EMAILS = administrator.email;
    process.env.REGISTRATION_MODE = "invitation";
    clearCapturedEmails();
  });
  afterEach(() => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });
  afterAll(() => harness.tearDown());

  const freshEmail = () => `invitee-${crypto.randomUUID()}@example.test`;
  let clientNumber = 0;
  const clientIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  /** A direct Better Auth sign-up request, as a browser or script could send it. */
  const signUp = (email: string, invitationToken?: string) => harness.auth.handler(new Request("http://localhost:5173/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${clientIp}.${++clientNumber}` },
    body: JSON.stringify({ name: "Invitee", email, password: "password123", ...(invitationToken ? { invitationToken } : {}) }),
  }));

  /** Invite an email and return the token from the link in the invitation email. */
  async function invite(email: string, options: { administrator?: boolean } = {}) {
    await sendInvitation(database, { actorUserId: administrator.userId, email, administrator: options.administrator ?? false });
    return latestToken(email);
  }

  function latestToken(email: string) {
    const sent = capturedAuthEmails().filter((message) => message.to === email).at(-1);
    expect(sent, `no invitation email to ${email}`).toBeDefined();
    const token = sent!.text.match(/\/sign-up\?invitation=([\w-]+)/)?.[1];
    expect(token).toBeDefined();
    return token!;
  }

  const invitationOf = async (email: string) => (await listInvitations(database)).find((entry) => entry.email === email);
  const userOf = async (email: string) => (await database.select().from(user).where(eq(user.email, email)))[0];
  const refusal = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error("The action was not refused."); },
    (error: unknown) => {
      if (!(error instanceof AdministrationRefusal)) throw error;
      return error.code;
    },
  );

  it("refuses to sign anyone up without an invitation while registration is invitation-only", async () => {
    const email = freshEmail();

    expect((await signUp(email)).status).toBe(403);
    expect(await userOf(email)).toBeUndefined();
  });

  it("shows the sign-up form only for a usable invitation link while registration is invitation-only", async () => {
    const email = freshEmail();
    const token = await invite(email);

    expect(await signUpPage(database, null)).toEqual({ form: "closed", reason: "invitation_only", registration: "invitation" });
    expect(await signUpPage(database, token)).toEqual({ form: "invitation", email, token });
    expect(await signUpPage(database, "unknown-token")).toEqual({ form: "closed", reason: "invalid_invitation", registration: "invitation" });

    process.env.REGISTRATION_MODE = "open";
    expect(await signUpPage(database, null)).toEqual({ form: "open" });
    expect(await signUpPage(database, token)).toEqual({ form: "invitation", email, token });
    expect(await signUpPage(database, "unknown-token")).toEqual({ form: "closed", reason: "invalid_invitation", registration: "open" });
  });

  it("emails the invitee a link to sign up with, which tells them what Administrators can read", async () => {
    const email = freshEmail();
    await invite(email);

    const [sent] = capturedAuthEmails();
    expect(sent.to).toBe(email);
    expect(sent.text).toContain(`${authBaseUrl()}/sign-up?invitation=`);
    expect(sent.text).toMatch(/7 days/);
    expect(sent.text).toMatch(/Administrators can read your Quotes and your conversations/);
    expect(sent.text).toMatch(/30 days/);
    expect(await invitationOf(email)).toMatchObject({ state: "pending", administrator: false, invitedByEmail: administrator.email });
  });

  it("signs up the invitee through their link, once, as an active User with the role they were invited with", async () => {
    const email = freshEmail();
    const token = await invite(email, { administrator: true });
    expect(await invitationForSignUp(database, token)).toEqual({ email, administrator: true });

    expect((await signUp(email, token)).status).toBe(200);

    expect(await userOf(email)).toMatchObject({ status: "active", administrator: true, emailVerified: false });
    // The invitation is used up: the link no longer opens the sign-up form and is no longer listed.
    expect(await invitationForSignUp(database, token)).toBeNull();
    expect(await invitationOf(email)).toBeUndefined();
    expect((await listUsers(database)).find((entry) => entry.email === email)).toMatchObject({ administrator: "granted" });
  });

  it("accepts an invitation link only for the email it was sent to", async () => {
    const token = await invite(freshEmail());
    const other = freshEmail();

    expect((await signUp(other, token)).status).toBe(403);
    expect(await userOf(other)).toBeUndefined();
  });

  it("refuses an expired invitation link, and resending replaces the old link with a new one", async () => {
    const email = freshEmail();
    const first = await invite(email);
    await database.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.email, email));
    expect(await invitationOf(email)).toMatchObject({ state: "expired" });
    expect(await invitationForSignUp(database, first)).toBeNull();
    expect((await signUp(email, first)).status).toBe(403);

    await resendInvitation(database, { actorUserId: administrator.userId, invitationId: (await invitationOf(email))!.id });
    const second = latestToken(email);

    expect(second).not.toBe(first);
    const listed = await invitationOf(email);
    expect(listed).toMatchObject({ state: "pending" });
    const days = (listed!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect((await signUp(email, first)).status).toBe(403);
    expect((await signUp(email, second)).status).toBe(200);
  });

  it("refuses a cancelled invitation link and keeps listing the invitation as cancelled", async () => {
    const email = freshEmail();
    const token = await invite(email);

    await cancelInvitation(database, { actorUserId: administrator.userId, invitationId: (await invitationOf(email))!.id });

    expect(await invitationOf(email)).toMatchObject({ state: "cancelled" });
    expect((await signUp(email, token)).status).toBe(403);
    expect(await userOf(email)).toBeUndefined();
  });

  it("refuses to invite an email that already belongs to a User, or that has a pending invitation", async () => {
    const artisan = await existingUser("Existing Artisan");
    expect(await refusal(sendInvitation(database, { actorUserId: administrator.userId, email: artisan.email.toUpperCase(), administrator: false }))).toBe("user_exists");

    const email = freshEmail();
    await invite(email);
    expect(await refusal(sendInvitation(database, { actorUserId: administrator.userId, email, administrator: false }))).toBe("already_invited");
    expect(await refusal(sendInvitation(database, { actorUserId: administrator.userId, email: "not-an-email", administrator: false }))).toBe("invalid_email");
    expect(capturedAuthEmails().filter((message) => message.to === email)).toHaveLength(1);
  });

  it("saves and records nothing when the invitation email cannot be sent", async () => {
    const email = freshEmail();
    const saved = { delivery: process.env.EMAIL_DELIVERY, host: process.env.SMTP_HOST };
    process.env.EMAIL_DELIVERY = "smtp";
    delete process.env.SMTP_HOST;
    try {
      expect(await refusal(sendInvitation(database, { actorUserId: administrator.userId, email, administrator: false }))).toBe("email_not_sent");
    } finally {
      process.env.EMAIL_DELIVERY = saved.delivery;
      if (saved.host !== undefined) process.env.SMTP_HOST = saved.host;
    }

    expect(await invitationOf(email)).toBeUndefined();
    expect((await listAdministratorActions(database)).filter((record) => record.targetEmail === email)).toEqual([]);
  });

  it("invites again an email whose invitation expired or was cancelled", async () => {
    const email = freshEmail();
    const first = await invite(email);
    await cancelInvitation(database, { actorUserId: administrator.userId, invitationId: (await invitationOf(email))!.id });

    const second = await invite(email, { administrator: true });

    expect(await invitationOf(email)).toMatchObject({ state: "pending", administrator: true });
    expect((await signUp(email, first)).status).toBe(403);
    expect((await signUp(email, second)).status).toBe(200);
  });

  it("refuses invitation changes from a User who is not an Administrator", async () => {
    const artisan = await existingUser("Not An Administrator");
    const email = freshEmail();

    expect(await refusal(sendInvitation(database, { actorUserId: artisan.userId, email, administrator: true }))).toBe("not_administrator");
    expect(await invitationOf(email)).toBeUndefined();

    await invite(email);
    const invitationId = (await invitationOf(email))!.id;
    expect(await refusal(resendInvitation(database, { actorUserId: artisan.userId, invitationId }))).toBe("not_administrator");
    expect(await refusal(cancelInvitation(database, { actorUserId: artisan.userId, invitationId }))).toBe("not_administrator");
    expect(await invitationOf(email)).toMatchObject({ state: "pending" });
  });

  it("refuses to resend or cancel an invitation that was already accepted", async () => {
    const email = freshEmail();
    const token = await invite(email);
    const invitationId = (await invitationOf(email))!.id;
    expect((await signUp(email, token)).status).toBe(200);

    expect(await refusal(resendInvitation(database, { actorUserId: administrator.userId, invitationId }))).toBe("invitation_accepted");
    expect(await refusal(cancelInvitation(database, { actorUserId: administrator.userId, invitationId }))).toBe("invitation_accepted");
  });

  it("records sending, resending and cancelling in the Administrator action record", async () => {
    const email = freshEmail();
    const adminEmail = freshEmail();
    await invite(email);
    const invitationId = (await invitationOf(email))!.id;
    await resendInvitation(database, { actorUserId: administrator.userId, invitationId });
    await cancelInvitation(database, { actorUserId: administrator.userId, invitationId });
    await invite(adminEmail, { administrator: true });

    const records = (await listAdministratorActions(database)).filter((record) => record.targetEmail === email || record.targetEmail === adminEmail);

    expect(records.map((record) => [record.action, record.targetEmail])).toEqual([
      ["send_administrator_invitation", adminEmail],
      ["cancel_invitation", email],
      ["resend_invitation", email],
      ["send_invitation", email],
    ]);
    expect(records.every((record) => record.actorEmail === administrator.email)).toBe(true);
  });

  it("lets anyone sign up once registration is open, and still applies an invitation's role", async () => {
    process.env.REGISTRATION_MODE = "open";
    const email = freshEmail();
    const invited = freshEmail();
    await invite(invited, { administrator: true });

    expect((await signUp(email)).status).toBe(200);
    expect((await signUp(invited)).status).toBe(200);

    expect(await userOf(email)).toMatchObject({ status: "active", administrator: false });
    expect(await userOf(invited)).toMatchObject({ status: "active", administrator: true });
    expect(await invitationOf(invited)).toBeUndefined();
  });
});
