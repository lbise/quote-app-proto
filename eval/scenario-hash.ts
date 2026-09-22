import { createHash } from "node:crypto";
import type { Scenario } from "./types";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function scenarioHash(scenario: Scenario): string {
  return createHash("sha256").update(stable(scenario)).digest("hex");
}
