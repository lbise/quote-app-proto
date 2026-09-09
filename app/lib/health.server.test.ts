import { afterAll, describe, expect, it } from "vitest";

import { connectDatabase, type Database } from "./db.server";
import { readiness } from "./health.server";

function databaseReturning(rows: Array<{ id: number }>): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as Database;
}

function failingDatabase(): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            throw new Error("database unavailable");
          },
        }),
      }),
    }),
  } as unknown as Database;
}

describe("readiness", () => {
  it("reports ready when the installation marker exists", async () => {
    await expect(readiness(databaseReturning([{ id: 1 }]))).resolves.toEqual({
      status: 200,
      body: { status: "ready" },
    });
  });

  it("reports unavailable when the database cannot be checked", async () => {
    await expect(readiness(failingDatabase())).resolves.toEqual({
      status: 503,
      body: { status: "unavailable" },
    });
  });
});

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("PostgreSQL readiness", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);

  afterAll(async () => {
    await connection.pool.end();
  });

  it("checks the migrated installation marker in PostgreSQL", async () => {
    await expect(readiness(connection.db)).resolves.toEqual({
      status: 200,
      body: { status: "ready" },
    });
  });
});
