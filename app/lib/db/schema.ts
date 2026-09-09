import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

// A single installation marker proves migrations ran and storage survives redeploys.
// This is infrastructure state, not a customer or quote model.
export const appInstallation = pgTable(
  "app_installation",
  {
    id: integer("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("single_installation", sql`${table.id} = 1`)],
);
