import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { config as loadDotenv, parse } from 'dotenv';

class SetupError extends Error {}

function requireDevelopment() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new SetupError('This command is for development only. It does not run in production or test mode.');
  }
}

function localDatabase(connectionString: string | undefined): string {
  const message = 'Use a loopback PostgreSQL DATABASE_URL with a database name ending in _local or _test and no query parameters.';
  try {
    const url = new URL(connectionString ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^[A-Za-z0-9_]+_(local|test)$/.test(decodeURIComponent(url.pathname.slice(1)))
      || url.search || url.hash) throw new Error();
    return connectionString!;
  } catch { throw new SetupError(message); }
}

function privateHost(host: string) {
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

function appOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !privateHost(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

async function credentials(defaultOrigin: string) {
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!hidden) process.stdout.write(chunk); done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const abort = new AbortController();
  rl.on('SIGINT', () => { abort.abort(); rl.close(); });
  rl.on('close', () => abort.abort());
  const ask = async (label: string, secret = false) => {
    const answer = rl.question(label, { signal: abort.signal });
    hidden = secret;
    try { return await answer; }
    finally { hidden = false; if (secret) process.stdout.write('\n'); }
  };
  try {
    const email = (await ask('Email: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new SetupError('Enter a valid email address. No account was created.');
    const password = await ask('Password: ', true);
    if (password.length < 8 || password.length > 128) throw new SetupError('Use a password between 8 and 128 characters. No account was created.');
    const confirmation = await ask('Confirm password: ', true);
    if (password !== confirmation) throw new SetupError('Passwords do not match. No account was created.');
    const origin = appOrigin((await ask(`App URL [${defaultOrigin}]: `)).trim() || defaultOrigin);
    if (!origin) throw new SetupError('Use an HTTP URL with localhost or a private LAN/Tailscale IPv4 address, for example http://192.168.1.20:5173.');
    return { email, password, origin };
  } catch (error) {
    if (abort.signal.aborted) throw new SetupError('Cancelled. No account was created.');
    throw error;
  } finally { rl.close(); }
}

function updatedEnv(contents: string, values: Record<string, string>) {
  // Replace complete dotenv assignments, including quoted multiline values.
  let updated = contents;
  for (const [key, value] of Object.entries(values)) {
    const assignment = new RegExp(`^(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(?:"[^"\\r]*"|'[^'\\r]*'|\\x60[^\\x60\\r]*\\x60|[^\\r\\n]*)[^\\r\\n]*`, 'gm');
    const replacement = `${key}=${JSON.stringify(value)}`;
    if (assignment.test(updated)) updated = updated.replace(assignment, () => replacement);
    else updated += `${updated.endsWith('\n') ? '' : '\n'}${replacement}\n`;
  }
  return updated;
}

async function main() {
  requireDevelopment();
  if (process.argv.length > 2) throw new SetupError('Run npm run dev:user without arguments. Enter the password at the hidden prompt, not in command-line arguments.');
  const envPath = resolve('.env');
  let original: string;
  try { original = await readFile(envPath, 'utf8'); }
  catch { throw new SetupError('Create .env from .env.example and run npm run db:migrate first.'); }
  loadDotenv({ path: envPath, quiet: true });
  requireDevelopment();
  const databaseUrl = localDatabase(process.env.DATABASE_URL);
  const savedEnv = parse(original);
  const defaultOrigin = appOrigin(process.env.BETTER_AUTH_URL ?? '') ?? 'http://localhost:5173';
  console.info('Create a new verified account in your local development database. Existing accounts are not changed.');
  const addresses = Object.entries(networkInterfaces())
    .filter(([name]) => !/^(docker|br-|veth)/.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && privateHost(entry.address))
    .map(entry => `http://${entry.address}:5173`);
  if (addresses.length) console.info(`For another device, use the private address you will open: ${[...new Set(addresses)].join(' or ')}`);
  const input = await credentials(defaultOrigin);

  const allowed = new Set(`${savedEnv.AUTH_ALLOWED_EMAILS ?? ''} ${process.env.AUTH_ALLOWED_EMAILS ?? ''}`.split(/[\s,;]+/).filter(Boolean));
  allowed.add(input.email);
  const origins = new Set(`${savedEnv.AUTH_TRUSTED_ORIGINS ?? ''} ${process.env.AUTH_TRUSTED_ORIGINS ?? ''}`.split(/[\s,;]+/).filter(Boolean));
  origins.add(input.origin);
  origins.add('http://localhost:5173');
  const settings: Record<string, string> = {
    AUTH_ALLOWED_EMAILS: [...allowed].join(' '),
    BETTER_AUTH_URL: input.origin,
    AUTH_TRUSTED_ORIGINS: [...origins].join(' '),
  };
  if (!savedEnv.BETTER_AUTH_SECRET || savedEnv.BETTER_AUTH_SECRET.startsWith('replace-')) settings.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');

  // These overrides belong to this CLI process, never to production auth code.
  Object.assign(process.env, settings, { EMAIL_DELIVERY: 'fake' });
  const { connectDatabase } = await import('../app/lib/db.server');
  const { createAuthForDatabase } = await import('../app/lib/auth.server');
  const { capturedEmailsForTests } = await import('../app/lib/mail.server');
  const { user } = await import('../app/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const connection = connectDatabase(databaseUrl);
  try {
    const [existing] = await connection.db.select({ id: user.id }).from(user).where(eq(user.email, input.email)).limit(1);
    if (existing) throw new SetupError('That account already exists. Its password and verification state were not changed. Sign in with its existing credentials or choose a new email.');
    if (await readFile(envPath, 'utf8') !== original) throw new SetupError('.env changed during setup. Run the command again. No account was created.');
    const auth = createAuthForDatabase(connection.db);
    const response = await auth.handler(new Request(`${input.origin}/api/auth/sign-up/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: input.origin },
      body: JSON.stringify({ name: 'Local Artisan', email: input.email, password: input.password }),
    }));
    if (!response.ok) throw new SetupError('Account creation failed. Check the email and password requirements, then retry.');
    const mail = capturedEmailsForTests().filter(message => message.to === input.email).at(-1);
    const verificationUrl = mail?.text.split('\n').find(line => line.startsWith(`${input.origin}/api/auth/verify-email?`));
    if (!verificationUrl) throw new SetupError('Account created, but local email verification could not finish. No password was changed.');
    // Follow Better Auth's normal verification link in-process. Nothing is emailed or exposed over HTTP.
    const verificationRequest = new URL(verificationUrl);
    verificationRequest.searchParams.delete('callbackURL');
    const verification = await auth.handler(new Request(verificationRequest));
    if (verification.status !== 200) throw new SetupError('Account created, but local email verification could not finish.');
    if (await readFile(envPath, 'utf8') !== original) throw new SetupError('Account created and verified, but .env changed. Add your email to AUTH_ALLOWED_EMAILS before signing in.');
    try { await writeFile(envPath, updatedEnv(original, settings), { mode: 0o600 }); }
    catch { throw new SetupError('Account created and verified, but .env could not be written. Add your email to AUTH_ALLOWED_EMAILS before signing in.'); }
    console.info(`\nVerified local account created for ${input.email}.`);
    console.info('Updated .env with the allowed email, app URL and trusted origins. No password was written to .env.');
    console.info(`Restart npm run dev:network, then sign in at ${input.origin}/sign-in with the password you chose.`);
    console.info('Keep port 5173 on your trusted private network. Exported shell variables can override .env.');
  } finally { await connection.pool.end(); }
}

main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Local account setup failed. Check that local PostgreSQL is running and npm run db:migrate has succeeded.');
  process.exitCode = 1;
});
