import { and, eq, sql } from "drizzle-orm";

import { getAuth } from "./auth.server";
import { businessDefaults, businessLogo } from "./db/schema";
import { type Database, getDatabase } from "./db.server";
import { BodyLimitError, readLimitedBytes } from "./limited-body.server";
import { assertMutationOrigin, authorised, businessDefaultsFor, failureResponse, RequestFailure, type SessionAuth } from "./quotes.server";

export const MAX_LOGO_BYTES = 1_000_000;

export type BusinessLogoImage = { contentType: "image/png" | "image/jpeg"; data: Uint8Array };

/** Identify PNG and JPEG by their signatures. The declared content type is not trusted, and SVG is never accepted. */
export function logoContentType(data: Uint8Array): BusinessLogoImage["contentType"] | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => data[index] === byte)) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

/** A logo belonging to this Artisan Business. A logo of another business is never returned. */
export async function findBusinessLogo(database: Database, businessId: string, id: string | undefined): Promise<BusinessLogoImage | null> {
  if (!id) return null;
  const [logo] = await database.select({ contentType: businessLogo.contentType, data: businessLogo.data }).from(businessLogo)
    .where(and(eq(businessLogo.id, id), eq(businessLogo.businessId, businessId))).limit(1);
  return logo ? { contentType: logo.contentType as BusinessLogoImage["contentType"], data: logo.data } : null;
}

const logoPath = /^\/api\/business-logo\/([A-Za-z0-9_-]{1,128})$/;

/**
 * - `POST /api/business-logo` with a PNG or JPEG body of at most 1 MB: stores a new logo and makes it the business default.
 * - `GET /api/business-logo/:id`: one of this business's logos.
 */
export function createBusinessLogoHandler(dependencies: { database?: Database; auth?: SessionAuth; now?: () => Date } = {}) {
  const database = dependencies.database ?? getDatabase();
  const auth = dependencies.auth ?? getAuth();
  const now = dependencies.now ?? (() => new Date());

  return async function businessLogoHandler(request: Request): Promise<Response> {
    try {
      const businessId = await authorised(request, auth, database);
      const path = new URL(request.url).pathname;
      if (request.method === "GET") {
        const match = logoPath.exec(path);
        const logo = match ? await findBusinessLogo(database, businessId, match[1]) : null;
        if (!logo) throw new RequestFailure(404, "logo_not_found");
        return new Response(logo.data as Uint8Array<ArrayBuffer>, { headers: {
          "content-type": logo.contentType, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff",
        } });
      }
      if (request.method !== "POST" || path !== "/api/business-logo") throw new RequestFailure(405, "method_not_allowed");
      assertMutationOrigin(request);
      let data: Uint8Array;
      try { data = await readLimitedBytes(request, MAX_LOGO_BYTES); }
      catch (error) {
        if (error instanceof BodyLimitError) throw new RequestFailure(413, "logo_too_large");
        throw new RequestFailure(400, "invalid_request");
      }
      const contentType = logoContentType(data);
      if (!contentType) throw new RequestFailure(415, "unsupported_logo_type");
      const id = crypto.randomUUID();
      const updatedAt = now();
      await database.transaction(async (transaction) => {
        await transaction.insert(businessLogo).values({ id, businessId, contentType, data });
        await transaction.insert(businessDefaults).values({ businessId, defaults: { logoId: id }, updatedAt })
          .onConflictDoUpdate({ target: businessDefaults.businessId, set: { defaults: sql`${businessDefaults.defaults} || excluded.defaults`, updatedAt } });
      });
      return Response.json({ defaults: await businessDefaultsFor(database, businessId) }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return failureResponse(error, "request_failed");
    }
  };
}
