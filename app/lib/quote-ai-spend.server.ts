import { and, eq, sql } from "drizzle-orm";

import type { Database } from "./db.server";
import { quoteAISpend } from "./db/schema";

/**
 * A cumulative allowance in integer nanodollars. Reservation must be atomic
 * across server processes; release only returns the unused part of a
 * reservation whose usage was verified.
 */
export type QuoteAISpendLedger = {
  /** Adds `nanoUsd` unless the total would exceed `limitNanoUsd`. Returns false when refused. */
  reserve(nanoUsd: number, limitNanoUsd: number): Promise<boolean>;
  release(nanoUsd: number): Promise<void>;
};

/** One allowance per deployment database, shared by OpenRouter assistant calls and transcription. */
const scope = "openrouter";

export function databaseSpendLedger(database: Database): QuoteAISpendLedger {
  return {
    async reserve(nanoUsd, limitNanoUsd) {
      if (!Number.isSafeInteger(nanoUsd) || nanoUsd <= 0 || !Number.isSafeInteger(limitNanoUsd)) throw new Error("Invalid spend reservation.");
      await database.insert(quoteAISpend).values({ scope }).onConflictDoNothing();
      // A single conditional UPDATE serializes concurrent reservations on the row lock.
      const rows = await database.update(quoteAISpend)
        .set({ reservedNanoUsd: sql`${quoteAISpend.reservedNanoUsd} + ${nanoUsd}::bigint`, updatedAt: new Date() })
        .where(and(eq(quoteAISpend.scope, scope), sql`${quoteAISpend.reservedNanoUsd} + ${nanoUsd}::bigint <= ${limitNanoUsd}::bigint`))
        .returning({ reserved: quoteAISpend.reservedNanoUsd });
      return rows.length === 1;
    },
    async release(nanoUsd) {
      if (!Number.isSafeInteger(nanoUsd) || nanoUsd <= 0) return;
      await database.update(quoteAISpend)
        .set({ reservedNanoUsd: sql`${quoteAISpend.reservedNanoUsd} - ${nanoUsd}::bigint`, updatedAt: new Date() })
        .where(and(eq(quoteAISpend.scope, scope), sql`${quoteAISpend.reservedNanoUsd} >= ${nanoUsd}::bigint`));
    },
  };
}

/**
 * Connects only when a call reserves spend, so configuration and generation
 * errors never depend on the database. Importing the database module lazily
 * also avoids its .env side effect for callers that never reach it.
 */
export function deploymentSpendLedger(): QuoteAISpendLedger {
  const ledger = async () => databaseSpendLedger((await import("./db.server")).getDatabase());
  return {
    reserve: async (nanoUsd, limitNanoUsd) => (await ledger()).reserve(nanoUsd, limitNanoUsd),
    release: async (nanoUsd) => (await ledger()).release(nanoUsd),
  };
}

/** Current reserved total, for operators and tests. */
export async function reservedSpendNanoUsd(database: Database): Promise<number> {
  const [row] = await database.select({ reserved: quoteAISpend.reservedNanoUsd }).from(quoteAISpend).where(eq(quoteAISpend.scope, scope)).limit(1);
  return row?.reserved ?? 0;
}
