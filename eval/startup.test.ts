import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { get } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const cwd = resolve(import.meta.dirname, "..");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fakeDocker(body: string) {
  const directory = await mkdtemp(join(tmpdir(), "eval-start-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "docker.log");
  await writeFile(join(directory, "docker"), `#!/bin/sh\nprintf '%s|%s\\n' "$*" "${"${DATABASE_URL-unset}"}" >> '${log}'\n${body}\n`, { mode: 0o700 });
  return { directory, log };
}
function command(directory: string, args: string[] = []) {
  return spawnSync("npm", ["run", "eval:start", "--", ...args], {
    cwd, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DATABASE_URL: "postgresql://application-secret@localhost/app", TEST_DATABASE_URL: "postgresql://other-secret@localhost/test", EVAL_DB_CONTAINER: "startup-test", EVAL_DB_PORT: "55434" },
  });
}

it("rejects an invalid dashboard port before provisioning", async () => {
  const { directory, log } = await fakeDocker("exit 0");
  const result = command(directory, ["--port", "0"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Dashboard port must be an integer");
  await expect(readFile(log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails on missing Docker without contacting the application database", async () => {
  const { directory, log } = await fakeDocker('exit 127');
  const result = command(directory);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Start Docker");
  expect(result.stdout + result.stderr).not.toMatch(/application-secret|other-secret|postgresql:\/\//);
  expect(await readFile(log, "utf8")).toContain("info|unset");
});

it("rejects an existing non-evaluation container before migration or server startup", async () => {
  const { directory, log } = await fakeDocker(`case "$1" in
  info) exit 0 ;;
  inspect) if [ "$2" = '--format' ]; then echo false; fi; exit 0 ;;
  port) echo 0.0.0.0:55434; exit 0 ;;
esac`);
  const result = command(directory);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Evaluation database setup failed");
  expect(result.stdout + result.stderr).not.toContain("application-secret");
  expect(await readFile(log, "utf8")).not.toMatch(/exec|run|postgresql:\/\//);
});

it("fails closed when an existing evaluation database is not ready", async () => {
  const { directory, log } = await fakeDocker(`case "$1" in
  info) exit 0 ;;
  inspect)
    case "$3" in
      *Labels*) echo true ;;
      *Running*) echo true ;;
      *Config.Env*) echo '["POSTGRES_USER=quote_evaluation","POSTGRES_DB=quote_evaluation","POSTGRES_PASSWORD=quote_evaluation_local_only"]' ;;
      *Config.Image*) echo postgres:16-alpine ;;
    esac
    exit 0 ;;
  port) echo 127.0.0.1:55434; exit 0 ;;
  exec) exit 1 ;;
esac`);
  const result = command(directory);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Evaluation database setup failed");
  expect(result.stdout + result.stderr).not.toContain("application-secret");
  expect(await readFile(log, "utf8")).not.toContain("application-secret");
});

// Full startup needs the real migrated disposable database and executable
// dashboard server. These are integration checks, not prerequisites for npm test.
const integration = Boolean(process.env.EVAL_DATABASE_URL);
it.runIf(integration)("starts the executable dashboard on loopback in a subprocess", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-start-artifacts-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/eval-start.ts", "--port", "4328", "--root", root], {
    cwd, env: { ...process.env, DATABASE_URL: "postgresql://application-secret@localhost/app" }, stdio: ["ignore", "pipe", "pipe"],
  });
  cleanup.push(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>(resolve => child.once("exit", () => resolve()));
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  const deadline = Date.now() + 30_000;
  while (!output.includes("Evaluator dashboard:") && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  expect(output).toContain("Evaluator dashboard: http://127.0.0.1:4328");
  expect(output).not.toContain("application-secret");
  expect((await fetch("http://127.0.0.1:4328/")).status).toBe(200);
  const hostile = await new Promise<number | undefined>((resolve, reject) => {
    get("http://127.0.0.1:4328/", { headers: { host: "attacker.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
  });
  expect(hostile).toBe(403);
  const privateIp = Object.values(networkInterfaces()).flatMap(entries => entries ?? []).find(entry => entry.family === "IPv4" && !entry.internal)?.address;
  if (privateIp) {
    const reachable = await new Promise<boolean>(resolve => {
      const socket = connect({ host: privateIp, port: 4328, timeout: 1000 });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
    });
    expect(reachable).toBe(false);
  }
});
