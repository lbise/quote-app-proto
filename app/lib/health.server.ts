import { eq } from "drizzle-orm";

import { type Database, getDatabase } from "./db.server";
import { appInstallation } from "./db/schema";

export async function readiness(database?: Database) {
  try {
    const db = database ?? getDatabase();
    const installation = await db
      .select({ id: appInstallation.id })
      .from(appInstallation)
      .where(eq(appInstallation.id, 1))
      .limit(1);

    if (installation.length !== 1) throw new Error("Initial migration is missing.");

    return { status: 200, body: { status: "ready" } } as const;
  } catch {
    // Readiness is public. Never return SQL, credentials, hostnames or errors.
    return { status: 503, body: { status: "unavailable" } } as const;
  }
}
