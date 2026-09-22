import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
function command(...args: string[]) {
  return exec(process.execPath, ["--import", "tsx", "scripts/evaluate.ts", ...args], { env: { ...process.env, NODE_ENV: "production" }, timeout: 10_000 });
}
it("limits the no-op smoke command to full reconstructions", async () => {
  await expect(command("--offline-smoke", "--scenario", "joinery-injection-resistance", "--database-url", "invalid")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("reconstruction") });
});
it("rejects unsafe repetition counts before any execution", async () => {
  await expect(command("--repetitions", "9".repeat(400))).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("positive integer") });
});
it("rejects mixed live and offline flags", async () => {
  await expect(command("--offline-smoke", "--live", "--scenario", "joinery-full-reconstruction")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("cannot be used together") });
});
