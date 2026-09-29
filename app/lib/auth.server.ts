import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

import {
  assertAuthConfiguration,
  authBaseUrl,
  browserLanguage,
  canSignIn,
  hasApprovedAccess,
  normalizeEmail,
  parseLocaleCookie,
  registrationMode,
  type InterfaceLanguage,
  trustedOrigins,
} from "./auth-config.server";
import { provisionArtisanBusiness, getArtisanForUser } from "./artisan.server";
import { type Database, getDatabase } from "./db.server";
import { account, artisanBusiness, session, user, verification } from "./db/schema";
import { acceptInvitation, invitationForSignUp, usableInvitationForEmail } from "./invitations.server";
import { sendAuthEmail } from "./mail.server";
import { assertQuoteAIConfiguration } from "./quote-ai-config.server";

/** Better Auth error code returned when a blocked User tries to sign in. */
export const USER_NOT_ACTIVE = "USER_NOT_ACTIVE";

/** Better Auth error code returned when sign-up needs an invitation link. */
export const INVITATION_REQUIRED = "INVITATION_REQUIRED";

let authInstance: ReturnType<typeof createAuth> | undefined;

const invitationRequired = () => new APIError("FORBIDDEN", { code: INVITATION_REQUIRED, message: "Registration is by invitation only." });

function createAuth(database: Database = getDatabase()) {
  assertAuthConfiguration();
  assertQuoteAIConfiguration();
  const auth = betterAuth({
    appName: "Easy Quote",
    baseURL: authBaseUrl(),
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: { user, session, account, verification },
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      // Better Auth deletes every session after a successful reset.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: authUser, url }, request) => {
        await sendAuthEmail({
          to: authUser.email,
          url,
          kind: "reset",
          language: await languageForUser(authUser.id, database, request),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user: authUser, url }, request) => {
        await sendAuthEmail({
          to: authUser.email,
          url,
          kind: "verification",
          language: await languageForUser(authUser.id, database, request),
        });
      },
      afterEmailVerification: async (authUser) => {
        await provisionArtisanBusiness(authUser.id, database);
      },
    },
    user: {
      // Returned with every session so loaders and API handlers can reject
      // blocked Users. Neither field can be set through Better Auth endpoints.
      additionalFields: {
        status: { type: "string", input: false, defaultValue: "active", required: false },
        administrator: { type: "boolean", input: false, defaultValue: false, required: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Every sign-in path creates a session here, so a blocked User cannot sign in.
          before: async (newSession) => {
            const [owner] = await database
              .select({ email: user.email, status: user.status })
              .from(user)
              .where(eq(user.id, newSession.userId))
              .limit(1);
            if (!owner || !canSignIn(owner)) {
              throw new APIError("FORBIDDEN", { code: USER_NOT_ACTIVE, message: "Access is not available." });
            }
          },
        },
      },
      user: {
        create: {
          // A new User gets the role their invitation grants. Sign-up checks the
          // invitation link first; checking again here closes the gap in which
          // it could be cancelled. Operator scripts create Users without one.
          before: async (authUser, context) => {
            const invitation = await usableInvitationForEmail(database, authUser.email);
            if (!invitation && context?.path === "/sign-up/email" && registrationMode() === "invitation") return false;
            if (invitation?.administrator) return { data: { ...authUser, administrator: true } };
          },
          after: async (authUser, context) => {
            await acceptInvitation(database, authUser.email, authUser.id);
            const initialLanguage = parseLocaleCookie(context?.request?.headers.get("cookie") ?? null) ??
              browserLanguage(context?.request?.headers.get("accept-language") ?? null);
            await provisionArtisanBusiness(authUser.id, database, initialLanguage);
          },
        },
      },
    },
    hooks: {
      // This hook runs for HTTP requests as well as internal clients. It is the
      // server-side registration gate; the sign-up page is not an access control.
      // While registration is invitation-only, sign-up needs a usable
      // invitation link for the same email.
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/sign-up/email" && registrationMode() === "invitation") {
          const body = context.body as { email?: unknown; invitationToken?: unknown } | undefined;
          const invitation = await invitationForSignUp(database, body?.invitationToken);
          if (typeof body?.email !== "string" || !invitation || invitation.email !== normalizeEmail(body.email)) {
            throw invitationRequired();
          }
        }
      }),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      disableSessionRefresh: true,
    },
    trustedOrigins: () => trustedOrigins(),
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
  });
  return auth;
}

export function getAuth() {
  if (!authInstance) authInstance = createAuth();
  return authInstance;
}

/** Build an isolated auth instance for integration tests. */
export function createAuthForDatabase(database: Database) {
  return createAuth(database);
}

async function languageForUser(
  userId: string,
  database: Database,
  request?: Request,
): Promise<InterfaceLanguage> {
  const profile = await getArtisanForUser(userId, database);
  if (profile?.interfaceLanguage === "en" || profile?.interfaceLanguage === "fr") {
    return profile.interfaceLanguage;
  }
  return browserLanguage(request?.headers.get("accept-language") ?? null);
}

export type AuthSession = NonNullable<Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>>;

export async function getSession(request: Request) {
  return getAuth().api.getSession({ headers: request.headers });
}

export async function requireApprovedArtisan(request: Request) {
  const current = await getSession(request);
  if (!current) throw new Response("Authentication required.", { status: 401 });
  if (!hasApprovedAccess(current.user)) {
    throw new Response("Access is not available.", { status: 403 });
  }

  let profile = await getArtisanForUser(current.user.id);
  // Registration provisions the relationship. This fallback only repairs an
  // interrupted first provision; established requests stay read-only.
  if (!profile) profile = (await provisionArtisanBusiness(current.user.id)).artisan;
  const database = getDatabase();
  const [business] = await database
    .select()
    .from(artisanBusiness)
    .where(eq(artisanBusiness.id, profile.businessId))
    .limit(1);
  if (!business) throw new Response("Artisan Business unavailable.", { status: 403 });
  return { ...current, artisan: profile, business };
}

