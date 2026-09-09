import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { artisanBusiness } from "./db/schema";
import { connectDatabase } from "./db.server";
import { createAuthForDatabase } from "./auth.server";

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("Better Auth access rules", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const email = `approved-${Date.now()}@example.com`;
  const auth = createAuthForDatabase(connection.db);
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;

  beforeAll(() => {
    process.env.AUTH_ALLOWED_EMAILS = email;
    process.env.EMAIL_DELIVERY = "fake";
  });

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await connection.pool.end();
  });

  it("rejects an unapproved direct registration request", async () => {
    const response = await auth.handler(new Request("http://localhost:5173/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No access", email: "blocked@example.com", password: "password123" }),
    }));
    expect(response.status).toBe(403);
  });

  it("accepts an approved registration and provisions one business", async () => {
    const response = await auth.handler(new Request("http://localhost:5173/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "en-US" },
      body: JSON.stringify({ name: "Approved", email, password: "password123" }),
    }));
    expect(response.status).toBe(200);
    const businesses = await connection.db
      .select()
      .from(artisanBusiness)
      .where(eq(artisanBusiness.ownerUserId, (await response.json()).user.id));
    expect(businesses).toHaveLength(1);
  });
});
