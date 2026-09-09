import { eq } from "drizzle-orm";

import type { InterfaceLanguage } from "./auth-config.server";
import { type Database, getDatabase } from "./db.server";
import { artisan, artisanBusiness } from "./db/schema";

export async function provisionArtisanBusiness(
  userId: string,
  database?: Database,
  initialLanguage: InterfaceLanguage = "fr",
) {
  const db = database ?? getDatabase();
  return db.transaction(async (transaction) => {
    await transaction
      .insert(artisanBusiness)
      .values({ id: crypto.randomUUID(), ownerUserId: userId })
      .onConflictDoNothing({ target: artisanBusiness.ownerUserId });

    const [business] = await transaction
      .select()
      .from(artisanBusiness)
      .where(eq(artisanBusiness.ownerUserId, userId))
      .limit(1);
    if (!business) throw new Error("Artisan Business could not be provisioned.");

    await transaction
      .insert(artisan)
      .values({ id: crypto.randomUUID(), userId, businessId: business.id, interfaceLanguage: initialLanguage })
      .onConflictDoNothing({ target: artisan.userId });

    const [owner] = await transaction
      .select()
      .from(artisan)
      .where(eq(artisan.userId, userId))
      .limit(1);
    if (!owner) throw new Error("Artisan ownership could not be provisioned.");
    return { business, artisan: owner };
  });
}

export async function getArtisanForUser(userId: string, database?: Database) {
  const db = database ?? getDatabase();
  const [result] = await db
    .select()
    .from(artisan)
    .where(eq(artisan.userId, userId))
    .limit(1);
  return result;
}

export async function setInterfaceLanguage(
  userId: string,
  language: InterfaceLanguage,
  database?: Database,
): Promise<void> {
  const db = database ?? getDatabase();
  await db.update(artisan).set({ interfaceLanguage: language }).where(eq(artisan.userId, userId));
}
