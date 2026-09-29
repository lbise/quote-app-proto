import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { isAdministrator, isBootstrapAdministrator, type SessionIdentity } from "./auth-config.server";
import { getAuth } from "./auth.server";
import type { Database } from "./db.server";
import {
  administratorAction,
  artisanBusiness,
  businessDefaults,
  session,
  user,
  type AdministratorActionKind,
  type UserStatus,
} from "./db/schema";

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

export type RefusalCode = "not_administrator" | "user_not_found" | "self" | "bootstrap_administrator" | "last_administrator";

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
  input: { actorUserId: string; targetUserId: string; action: AdministratorActionKind },
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    // Serialise administrator changes, so two Administrators cannot each
    // remove the other and leave no granted Administrator.
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('administrator_action'))`);
    const actor = await findUser(transaction, input.actorUserId);
    if (!actor || !isAdministrator(actor)) throw new AdministrationRefusal("not_administrator");
    const target = await findUser(transaction, input.targetUserId);
    if (!target) throw new AdministrationRefusal("user_not_found");

    const changed = await changeUser(transaction, input.action, actor, target);
    if (!changed) return false;
    await transaction.insert(administratorAction).values({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetUserId: target.id,
      targetEmail: target.email,
      action: input.action,
    });
    return true;
  });
}

type UserRow = typeof user.$inferSelect;

async function changeUser(transaction: Transaction, action: AdministratorActionKind, actor: UserRow, target: UserRow): Promise<boolean> {
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
