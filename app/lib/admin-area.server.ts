import { AdministrationRefusal, requireAdministrator } from "./administration.server";
import { getArtisanForUser } from "./artisan.server";
import { type Database, getDatabase } from "./db.server";

/**
 * What every admin area page loader starts with: the signed-in Administrator,
 * their interface language and the database. Everyone else gets a not-found
 * response.
 */
export async function adminPage(request: Request): Promise<{ administratorId: string; locale: "fr" | "en"; database: Database }> {
  const administrator = await requireAdministrator(request);
  const database = getDatabase();
  const profile = await getArtisanForUser(administrator.id, database);
  return { administratorId: administrator.id, locale: profile?.interfaceLanguage === "en" ? "en" : "fr", database };
}

/** Run an admin read; a role removed since the session check reads as not found, like the rest of the area. */
export async function asAdministrator<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AdministrationRefusal) throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
