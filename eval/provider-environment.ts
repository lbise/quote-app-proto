import { readFileSync } from "node:fs";
import { parse } from "dotenv";

/** Never load database URLs, process options, or executable configuration. */
export function readProviderEnvironment({ file, optionalFile = false }: { file?: string; optionalFile?: boolean } = {}): Record<string, string | undefined> {
  let values: Record<string, string> = {};
  if (file) {
    try { values = parse(readFileSync(file)); }
    catch (error) {
      if (!optionalFile || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Could not read the provider environment file. Check its access permissions.");
      }
    }
  }
  return Object.fromEntries(["QUOTE_AI_PROVIDER", "QUOTE_AI_MODEL", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "QUOTE_AI_TIMEOUT_MS"]
    .map(name => [name, process.env[name] === undefined ? values[name] : process.env[name]]));
}
