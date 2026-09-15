import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

import {
  assertAuthConfiguration,
  authBaseUrl,
  browserLanguage,
  hasApprovedAccess,
  isEmailAllowed,
  parseLocaleCookie,
  type InterfaceLanguage,
  trustedOrigins,
} from "./auth-config.server";
import { provisionArtisanBusiness, getArtisanForUser } from "./artisan.server";
import { type Database, getDatabase } from "./db.server";
import { account, artisanBusiness, session, user, verification } from "./db/schema";
import { sendAuthEmail } from "./mail.server";
import {
  assertQuoteAIConfiguration,
  isFictionalQuoteAITest,
  isFictionalTestIdentity,
} from "./quote-ai-config.server";

let authInstance: ReturnType<typeof createAuth> | undefined;

function emailCanAccessThisInstance(email: string): boolean {
  return isEmailAllowed(email) && (!isFictionalQuoteAITest() || isFictionalTestIdentity(email));
}

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
    databaseHooks: {
      user: {
        create: {
          before: async (authUser) => {
            if (!emailCanAccessThisInstance(authUser.email)) {
              throw new APIError("FORBIDDEN", { message: "Registration is not available." });
            }
          },
          after: async (authUser, context) => {
            const initialLanguage = parseLocaleCookie(context?.request?.headers.get("cookie") ?? null) ??
              browserLanguage(context?.request?.headers.get("accept-language") ?? null);
            await provisionArtisanBusiness(authUser.id, database, initialLanguage);
          },
        },
      },
    },
    hooks: {
      // This hook runs for HTTP requests as well as internal clients. It is the
      // server-side registration gate; a page redirect is not an access control.
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/sign-up/email") {
          const body = context.body as { email?: unknown } | undefined;
          if (typeof body?.email !== "string" || !emailCanAccessThisInstance(body.email)) {
            throw new APIError("FORBIDDEN", { message: "Registration is not available." });
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
  if (!hasApprovedAccess(current.user) ||
    (isFictionalQuoteAITest() && !isFictionalTestIdentity(current.user.email))) {
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

