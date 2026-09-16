import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const composeFile = resolve(root, "compose.quote-ai-fictional.yml");
const fictionalEmail = "fictional-artisan@example.test";
const fictionalPassword = "Fictional-test-only-2026!";
const origin = "http://127.0.0.1:5175";

class WorkflowError extends Error {}

function command(commandName: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(commandName, args, { cwd: root, env, stdio: "inherit" });
  return once(child, "exit").then(([code, signal]) => {
    if (code !== 0) throw new WorkflowError(`${commandName} ${args.join(" ")} failed${signal ? ` (${signal})` : ""}.`);
  });
}

function workflowEnvironment(): NodeJS.ProcessEnv {
  if (process.env.NODE_ENV === "production") throw new WorkflowError("The fictional workflow cannot run in production.");
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const termsReview = process.env.QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE?.trim();
  if (!geminiKey) throw new WorkflowError("Set GEMINI_API_KEY in your shell. The workflow does not read it from .env.");
  if (!termsReview) {
    throw new WorkflowError("Set QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE after checking the applicable Gemini terms and region.");
  }

  // Do not inherit .env values or a caller's DATABASE_URL. The application may
  // load .env in development, but these explicit values take precedence.
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TERM: process.env.TERM,
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://easy_quote@127.0.0.1:55433/easy_quote_fictional",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    BETTER_AUTH_URL: origin,
    AUTH_TRUSTED_ORIGINS: origin,
    AUTH_ALLOWED_EMAILS: fictionalEmail,
    EMAIL_DELIVERY: "fake",
    QUOTE_AI_ENABLED: "true",
    QUOTE_AI_PROVIDER: "google",
    QUOTE_AI_MODEL: process.env.QUOTE_AI_MODEL?.trim() || "gemini-3.5-flash-lite",
    GEMINI_API_KEY: geminiKey,
    QUOTE_AI_TIMEOUT_MS: process.env.QUOTE_AI_TIMEOUT_MS?.trim() || "20000",
    QUOTE_AI_NO_TRAINING_CONFIRMED: "false",
    QUOTE_AI_FICTIONAL_TEST_MODE: "true",
    QUOTE_AI_FICTIONAL_TEST_IDENTITIES: fictionalEmail,
    QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE: termsReview,
    HOST: "127.0.0.1",
    PORT: "5175",
  };
}

async function createFictionalIdentity(env: NodeJS.ProcessEnv): Promise<void> {
  Object.assign(process.env, env);
  const { assertQuoteAIConfiguration } = await import("../app/lib/quote-ai-config.server");
  assertQuoteAIConfiguration(process.env);
  const { connectDatabase } = await import("../app/lib/db.server");
  const { createAuthForDatabase } = await import("../app/lib/auth.server");
  const { capturedAuthEmails } = await import("../app/lib/mail.server");

  const connection = connectDatabase(env.DATABASE_URL!);
  try {
    const auth = createAuthForDatabase(connection.db);
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: "Fictional Artisan", email: fictionalEmail, password: fictionalPassword }),
    }));
    if (!response.ok) throw new WorkflowError("Could not create the fictional test identity.");

    const mail = capturedAuthEmails().filter(message => message.to === fictionalEmail).at(-1);
    const verificationUrl = mail?.text.split("\n").find(line => line.startsWith(`${origin}/api/auth/verify-email?`));
    if (!verificationUrl) throw new WorkflowError("Could not verify the fictional test identity.");
    const verificationRequest = new URL(verificationUrl);
    verificationRequest.searchParams.delete("callbackURL");
    const verification = await auth.handler(new Request(verificationRequest));
    if (verification.status !== 200) throw new WorkflowError("Could not verify the fictional test identity.");
  } finally {
    await connection.pool.end();
  }
}

async function main(): Promise<void> {
  const env = workflowEnvironment();
  const { assertQuoteAIConfiguration } = await import("../app/lib/quote-ai-config.server");
  assertQuoteAIConfiguration(env);
  const compose = ["compose", "-p", "easy-quote-fictional", "-f", composeFile];
  let started = false;
  try {
    // A prior stopped fictional run is discarded. This command never names or
    // imports the normal development database or its volume.
    await command("docker", [...compose, "down", "--volumes", "--remove-orphans"], env);
    await command("docker", [...compose, "up", "--detach", "--wait", "--renew-anon-volumes"], env);
    started = true;
    await command(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "scripts/migrate.ts"], env);
    await createFictionalIdentity(env);

    console.info(`\nFictional test app: ${origin}`);
    console.info(`Email: ${fictionalEmail}`);
    console.info(`Password: ${fictionalPassword}`);
    console.info("Use only fictional work, Customers, prices, and conversations. Ctrl-C deletes this database.");

    const server = spawn(process.execPath, [resolve(root, "node_modules/@react-router/dev/bin.cjs"), "dev", "--host", "127.0.0.1", "--port", "5175", "--strictPort"], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    let interrupted = false;
    const stop = () => { interrupted = true; server.kill("SIGTERM"); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const [code] = await once(server, "exit");
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (code !== 0 && !interrupted) throw new WorkflowError("The fictional test app stopped unexpectedly.");
  } finally {
    if (started) await command("docker", [...compose, "down", "--volumes", "--remove-orphans"], env);
  }
}

main().catch(error => {
  console.error(error instanceof WorkflowError ? error.message : "Fictional Quote AI workflow failed.");
  process.exitCode = 1;
});
