import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { AdministrationRefusal, applyAdministratorAction, listAdministratorActions, listUsers, requireAdministrator } from "./administration.server";
import { isBlockedResponse } from "./auth-ui.server";
import { user } from "./db/schema";
import { quoteHttpHarness, quoteSteps } from "./quote-http.test-support";
import { createQuoteHandler } from "./quotes.server";

// #50: Users with roles, blocking and an Administrator-only area.

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("administering Users", () => {
  const harness = quoteHttpHarness("administration");
  const database = harness.connection.db;
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeAll(() => harness.setUp());
  afterEach(() => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });
  afterAll(() => harness.tearDown());

  const cookieFrom = (response: Response) => response.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  const readQuoteList = (cookie: string) => createQuoteHandler({ database, auth: harness.auth })(
    new Request("http://localhost:5173/api/quotes", { headers: { cookie } }),
  );
  /** Read a Quote through the Quote HTTP boundary with a given session cookie. */
  const readQuote = (cookie: string, id: string) => createQuoteHandler({ database, auth: harness.auth })(
    new Request(`http://localhost:5173/api/quotes?id=${id}`, { headers: { cookie } }),
  );

  /** A User who is an Administrator because ADMIN_EMAILS lists them. */
  async function bootstrapAdministrator() {
    const administrator = await harness.artisan("Bootstrap Administrator");
    process.env.ADMIN_EMAILS = administrator.email;
    return administrator;
  }

  it("blocks a User: their sessions end, they cannot sign in, and unblocking restores their Quotes", async () => {
    const administrator = await bootstrapAdministrator();
    const artisan = await harness.artisan("Blocked Artisan");
    const created = await quoteSteps(artisan.request).create();

    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: artisan.userId, action: "block" });

    expect((await artisan.request()).status).toBe(401);
    const refused = await artisan.signIn();
    expect(refused.status).toBe(403);
    expect(await isBlockedResponse(refused)).toBe(true);

    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: artisan.userId, action: "unblock" });

    const signedIn = await artisan.signIn();
    expect(signedIn.status).toBe(200);
    expect((await readQuote(cookieFrom(signedIn), created.id)).status).toBe(200);
    expect((await readQuote(artisan.cookie, created.id)).status).toBe(401); // the old session stays revoked
  });

  it("still refuses a session that survives blocking, for example one created while the block was applied", async () => {
    const artisan = await harness.artisan("Racing Artisan");
    // Simulate the race directly: the session exists, the User is blocked.
    await database.update(user).set({ status: "blocked" }).where(eq(user.id, artisan.userId));

    const response = await artisan.request();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "access_denied" });
  });

  it("keeps access for a signed-up User who is no longer in AUTH_ALLOWED_EMAILS", async () => {
    const artisan = await harness.artisan("Unlisted Artisan");
    process.env.AUTH_ALLOWED_EMAILS = "someone-else@example.test";
    try {
      expect((await artisan.request()).status).toBe(200);
      expect((await artisan.signIn()).status).toBe(200);
    } finally {
      harness.setUp();
    }
  });

  const refusal = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error("The action was not refused."); },
    (error: unknown) => {
      if (!(error instanceof AdministrationRefusal)) throw error;
      return error.code;
    },
  );

  it("grants and removes the Administrator role", async () => {
    const administrator = await bootstrapAdministrator();
    const first = await harness.artisan("First Granted");
    const second = await harness.artisan("Second Granted");
    const act = (targetUserId: string, action: "grant_administrator" | "remove_administrator") =>
      applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId, action });
    const role = async (userId: string) => (await listUsers(database)).find((entry) => entry.id === userId)?.administrator;

    await act(first.userId, "grant_administrator");
    expect(await role(first.userId)).toBe("granted");

    // A granted Administrator can use their role at once.
    await applyAdministratorAction(database, { actorUserId: first.userId, targetUserId: second.userId, action: "grant_administrator" });
    expect(await role(second.userId)).toBe("granted");

    await act(second.userId, "remove_administrator");
    expect(await role(second.userId)).toBe("none");
    expect(await role(administrator.userId)).toBe("bootstrap");
  });

  it("refuses to let an Administrator block themselves or remove their own role", async () => {
    const administrator = await bootstrapAdministrator();
    const granted = await harness.artisan("Granted Administrator");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: granted.userId, action: "grant_administrator" });
    const other = await harness.artisan("Other Granted Administrator");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: other.userId, action: "grant_administrator" });

    expect(await refusal(applyAdministratorAction(database, { actorUserId: granted.userId, targetUserId: granted.userId, action: "block" }))).toBe("self");
    expect(await refusal(applyAdministratorAction(database, { actorUserId: granted.userId, targetUserId: granted.userId, action: "remove_administrator" }))).toBe("self");
    expect((await granted.request()).status).toBe(200);
  });

  it("never removes an ADMIN_EMAILS Administrator's role or blocks them", async () => {
    const administrator = await bootstrapAdministrator();
    const granted = await harness.artisan("Granted Administrator");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: granted.userId, action: "grant_administrator" });

    for (const action of ["remove_administrator", "block"] as const) {
      expect(await refusal(applyAdministratorAction(database, { actorUserId: granted.userId, targetUserId: administrator.userId, action }))).toBe("bootstrap_administrator");
    }
    expect((await administrator.request()).status).toBe(200);
  });

  it("refuses to remove the last Administrator granted in the admin area", async () => {
    const administrator = await bootstrapAdministrator();
    // Remove every other granted role first, so exactly one remains.
    for (const entry of await listUsers(database)) {
      if (entry.administrator === "granted") await database.update(user).set({ administrator: false }).where(eq(user.id, entry.id));
    }
    const last = await harness.artisan("Last Granted Administrator");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: last.userId, action: "grant_administrator" });

    expect(await refusal(applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: last.userId, action: "remove_administrator" }))).toBe("last_administrator");
    // Blocking would leave no granted Administrator either.
    expect(await refusal(applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: last.userId, action: "block" }))).toBe("last_administrator");
    expect((await last.request()).status).toBe(200);
  });

  it("does not store a granted role for an ADMIN_EMAILS Administrator", async () => {
    const administrator = await bootstrapAdministrator();
    const granted = await harness.artisan("Granting Administrator");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: granted.userId, action: "grant_administrator" });

    expect(await applyAdministratorAction(database, { actorUserId: granted.userId, targetUserId: administrator.userId, action: "grant_administrator" })).toBe(false);
    process.env.ADMIN_EMAILS = "";
    expect((await listUsers(database)).find((entry) => entry.id === administrator.userId)?.administrator).toBe("none");
  });

  it("lets a blocked User back in once ADMIN_EMAILS lists them, so it is always a way back in", async () => {
    const administrator = await bootstrapAdministrator();
    const lockedOut = await harness.artisan("Locked Out Administrator");
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: lockedOut.userId, action: "block" });
    expect((await lockedOut.signIn()).status).toBe(403);

    process.env.ADMIN_EMAILS = lockedOut.email;
    const signedIn = await lockedOut.signIn();

    expect(signedIn.status).toBe(200);
    expect((await readQuoteList(cookieFrom(signedIn))).status).toBe(200);
  });

  it("refuses actions from a User who is not an Administrator", async () => {
    const artisan = await harness.artisan("Not An Administrator");
    const target = await harness.artisan("Target");

    expect(await refusal(applyAdministratorAction(database, { actorUserId: artisan.userId, targetUserId: target.userId, action: "block" }))).toBe("not_administrator");
    expect((await target.request()).status).toBe(200);
  });

  it("records every change with the acting Administrator, the User, the action and the time, newest first", async () => {
    const administrator = await bootstrapAdministrator();
    const artisan = await harness.artisan("Recorded Artisan");
    const before = Date.now();
    for (const action of ["block", "unblock", "grant_administrator", "remove_administrator"] as const) {
      if (action === "remove_administrator") {
        const keeper = await harness.artisan("Keeper");
        await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: keeper.userId, action: "grant_administrator" });
      }
      await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: artisan.userId, action });
    }
    // Repeating an action that changes nothing is not recorded.
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: artisan.userId, action: "unblock" });

    const records = (await listAdministratorActions(database)).filter((record) => record.targetEmail === artisan.email);

    expect(records.map((record) => record.action)).toEqual(["remove_administrator", "grant_administrator", "unblock", "block"]);
    expect(records.every((record) => record.actorEmail === administrator.email)).toBe(true);
    expect(records.every((record) => record.createdAt.getTime() >= before - 1000)).toBe(true);
  });

  it("lists each User with their status, role, Artisan Business and creation date", async () => {
    const administrator = await bootstrapAdministrator();
    const artisan = await harness.artisan("Listed Artisan");
    expect((await artisan.request({ action: "defaults-save", defaults: { businessName: "Atelier Listé" } })).status).toBe(200);
    await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: artisan.userId, action: "block" });

    const listed = (await listUsers(database)).find((entry) => entry.id === artisan.userId);

    expect(listed).toMatchObject({ name: "Listed Artisan", email: artisan.email, status: "blocked", administrator: "none", business: { name: "Atelier Listé" } });
    expect(listed?.createdAt).toBeInstanceOf(Date);
  });

  describe("the admin area", () => {
    const statusOf = (promise: Promise<unknown>) => promise.then(() => 200, (error: unknown) => {
      if (error instanceof Response) return error.status;
      throw error;
    });
    const pageRequest = (cookie?: string) => new Request("http://localhost:5173/admin", { headers: cookie ? { cookie } : {} });

    it("is not found for visitors and Artisans who are not Administrators", async () => {
      const artisan = await harness.artisan("Curious Artisan");

      expect(await statusOf(requireAdministrator(pageRequest(), harness.auth))).toBe(404);
      expect(await statusOf(requireAdministrator(pageRequest(artisan.cookie), harness.auth))).toBe(404);
    });

    it("cannot be opened by a User who tries to grant themselves the role through Better Auth", async () => {
      const artisan = await harness.artisan("Self-Promoting Artisan");
      const response = await harness.auth.handler(new Request("http://localhost:5173/api/auth/update-user", {
        method: "POST",
        headers: { cookie: artisan.cookie, origin: "http://localhost:5173", "content-type": "application/json" },
        body: JSON.stringify({ administrator: true }),
      }));

      expect(response.status).toBe(400);

      expect(await statusOf(requireAdministrator(pageRequest(artisan.cookie), harness.auth))).toBe(404);
    });

    it("opens for ADMIN_EMAILS and granted Administrators", async () => {
      const administrator = await bootstrapAdministrator();
      const granted = await harness.artisan("Granted Administrator");
      await applyAdministratorAction(database, { actorUserId: administrator.userId, targetUserId: granted.userId, action: "grant_administrator" });

      expect(await requireAdministrator(pageRequest(administrator.cookie), harness.auth)).toMatchObject({ id: administrator.userId });
      expect(await requireAdministrator(pageRequest(granted.cookie), harness.auth)).toMatchObject({ id: granted.userId });
    });
  });
});
