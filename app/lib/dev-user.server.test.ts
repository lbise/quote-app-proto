import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { createAuthForDatabase } from './auth.server';
import { connectDatabase } from './db.server';
import { user } from './db/schema';
import { createQuoteHandler } from './quotes.server';

const script = fileURLToPath(new URL('../../scripts/dev-user.ts', import.meta.url));
const password = 'local-command-test-password';

async function runSetup(contents: string, answers: string[] = [], overrides: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'quote-dev-user-'));
  await writeFile(join(directory, '.env'), contents, { mode: 0o644 });
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', ...overrides };
  for (const key of ['DATABASE_URL', 'AUTH_ALLOWED_EMAILS', 'BETTER_AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'EMAIL_DELIVERY', 'BETTER_AUTH_SECRET']) delete env[key];
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), script], { cwd: directory, env, stdio: 'pipe' });
      let output = '';
      let next = 0;
      const prompts = ['Email: ', 'Password: ', 'Confirm password: ', 'App URL'];
      const timer = setTimeout(() => { child.kill(); reject(new Error('Local account setup did not finish.')); }, 15_000);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (next < answers.length && output.includes(prompts[next])) child.stdin.write(`${answers[next++]}\n`);
      });
      child.stderr.on('data', chunk => { output += chunk.toString(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    return { ...result, contents: await readFile(join(directory, '.env'), 'utf8'), mode: (await stat(join(directory, '.env'))).mode & 0o777 };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it('refuses production mode before asking for credentials or changing configuration', async () => {
  const contents = 'DATABASE_URL=postgresql://localhost/easy_quote_local\n';
  const result = await runSetup(contents, [], { NODE_ENV: 'production' });
  expect(result.code).toBe(1);
  expect(result.output).toContain('development only');
  expect(result.output).not.toContain('Password:');
  expect(result.contents).toBe(contents);
});

it('refuses remote databases and connection-string host overrides', async () => {
  for (const url of ['postgresql://db.example.com/easy_quote_local', 'postgresql://localhost/production', 'postgresql://localhost/easy_quote_local?host=db.example.com']) {
    const contents = `DATABASE_URL=${url}\n`;
    const result = await runSetup(contents);
    expect(result.code).toBe(1);
    expect(result.output).toContain('loopback PostgreSQL');
    expect(result.contents).toBe(contents);
  }
});

it.runIf(Boolean(process.env.TEST_DATABASE_URL))('creates a verified local Artisan who can sign in and open the protected Quote workspace', async () => {
  const email = `dev-command-${crypto.randomUUID()}@example.test`;
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const localConfig = `# Keep unrelated configuration\nDATABASE_URL=${process.env.TEST_DATABASE_URL}\nAUTH_ALLOWED_EMAILS=another@example.test\nQUOTE_AI_ENABLED=false\n`;
  try {
    const result = await runSetup(localConfig, [email, password, password, 'http://192.168.1.20:5173']);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('Verified local account created');
    expect(result.output).not.toContain(password);
    expect(result.contents).not.toContain(password);
    expect(result.mode).toBe(0o600);
    const config = parse(result.contents);
    expect(config.AUTH_ALLOWED_EMAILS).toContain('another@example.test');
    expect(config.AUTH_ALLOWED_EMAILS).toContain(email);
    expect(config.BETTER_AUTH_URL).toBe('http://192.168.1.20:5173');
    expect(config.AUTH_TRUSTED_ORIGINS).toContain('http://192.168.1.20:5173');
    expect(config.AUTH_TRUSTED_ORIGINS).toContain('http://localhost:5173');
    expect(config.QUOTE_AI_ENABLED).toBe('false');
    expect(config.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);

    process.env.AUTH_ALLOWED_EMAILS = config.AUTH_ALLOWED_EMAILS;
    const auth = createAuthForDatabase(connection.db);
    const signIn = await auth.handler(new Request('http://localhost:5173/api/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    }));
    expect(signIn.status).toBe(200);
    const session = await signIn.json();
    expect(session.user.emailVerified).toBe(true);
    const cookie = signIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const quoteHandler = createQuoteHandler({ database: connection.db, auth });
    const quotes = await quoteHandler(new Request('http://localhost:5173/api/quotes', { headers: { cookie } }));
    expect(quotes.status).toBe(200);
    expect((await quotes.json()).quotes).toEqual([]);

    const repeated = await runSetup(result.contents, [email, 'different-test-password', 'different-test-password', 'http://localhost:5173']);
    expect(repeated.code).toBe(1);
    expect(repeated.output).toContain('already exists');
    expect(repeated.contents).toBe(result.contents);
    const stillSignsIn = await auth.handler(new Request('http://localhost:5173/api/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    }));
    expect(stillSignsIn.status).toBe(200);
  } finally {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    await connection.db.delete(user).where(eq(user.email, email));
    await connection.pool.end();
  }
}, 30_000);
