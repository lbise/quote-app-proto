# Easy Quote

Easy Quote is a prototype for small artisan businesses preparing customer quotes.

The application provides bilingual email/password authentication, Customer records and a conversational Quote workspace with editable Working Drafts and frozen Published Revisions. See [the Quote workflow](docs/quote-workflow.md).

## Run locally

Use Node.js 24 and Docker Compose.

Start the local PostgreSQL service, install dependencies and apply the migration. Compose binds PostgreSQL to localhost only and uses trust authentication because this database is disposable local development data, not a production service:

```sh
docker compose up -d postgres
npm ci
cp .env.example .env
# Set GEMINI_API_KEY in .env or the shell before starting the app.
npm run db:migrate
```

Start the development server on localhost with `npm run dev`, or bind it to the machine's private interfaces with `npm run dev:network`. The assistant is always configured and the server checks its provider, model and API key at startup. Server-side development commands load `.env`; the file is ignored by Git and excluded from Docker images. Production uses runtime environment variables instead.

The example environment uses captured mail (`EMAIL_DELIVERY=fake`) and `AUTH_ALLOWED_EMAILS=*`, so local development never sends real messages. Captured messages are held in the server process and are not exposed by an application endpoint. Use a specific address instead of `*` when testing the allowlist behavior.

### Create your local login

Normal registration requires email verification, which you cannot complete through the browser when mail delivery is `fake`. After applying migrations, create a verified local account instead:

```sh
npm run dev:user
```

Enter your email, password twice, and the URL you will open. Password input is hidden and the password is never written to `.env` or printed. The command follows Better Auth's verification flow using the captured email inside the setup process. It sends no real email and adds no verification-bypass endpoint.

For another device, enter the machine's LAN or Tailscale IPv4 URL, such as `http://192.168.1.11:5173`. The command suggests available private addresses. For this machine only, accept `http://localhost:5173`.

The command adds your email to `AUTH_ALLOWED_EMAILS`, sets `BETTER_AUTH_URL`, and updates `AUTH_TRUSTED_ORIGINS` in `.env`. Existing allowlist entries and unrelated configuration are preserved. If the file has no auth secret or still contains the example placeholder, it generates one. Existing accounts, passwords and verification states are never overwritten; choose a fresh email if an earlier registration is still unverified.

This command refuses non-development `NODE_ENV` values, remote database hosts, database names not ending in `_local` or `_test`, and connection URLs with query parameters. It only accepts loopback PostgreSQL connections. Use it with disposable local data, never with a tunnel to production.

Do not edit `.env` or run another setup command while this command is running. It checks for changes before saving, but cannot lock out unrelated editors. It replaces `.env` atomically with owner-only permissions to avoid partial writes and protect the generated secret.

Restart the development server after setup, then sign in with the credentials you chose. Exported shell variables take precedence over `.env`; unset conflicting auth settings if your changes do not take effect.

### Open the app

For a headless machine, start the server on its private interfaces:

```sh
npm run dev:network
```

Find the machine's private address with `hostname -I`, then open `http://<private-address>:5173` from another device on that network. The command binds the development server to `0.0.0.0`, so allow port 5173 only on the trusted private network in the host or network firewall. Do not expose this development server to the public internet.

The health endpoints are public and remain independent of authentication:

- `GET /health/live` checks that the process answers HTTP.
- `GET /health/ready` checks PostgreSQL and the initial migration.

Stop the local database with `docker compose down`. Add `-v` only when you want to delete its local data. If the database volume was created with the old password-based configuration, run `docker compose down -v` once before starting it again.

Run the checks and build with:

```sh
npm run check
npm run build
```

## Assistant evaluation

Run `npm run eval:start` with Docker running to prepare the dedicated evaluation database and open the loopback evaluator dashboard. For private-network access, pass `-- --host <local-private-ip>`; there is no login, so restrict that port to trusted devices. Run `npm run eval:review` to browse fictional contract checks, source-derived scenarios and saved results on your trusted network, without provider calls. Preview four small checks, including a multi-paragraph facts case, and one combined multi-batch check with `npm run eval:run -- --suite contract`. See [evaluation.md](docs/evaluation.md) for offline replays and bounded live Gemini runs. The evaluator can launch, monitor and stop direct Google sessions using server-configured credentials. Browser Start authorizes the selected adapted inputs, settings and shared call/time/USD limits without a separate approval checkbox. Live CLI runs retain their explicit provider-data approval flag. Reopening shows saved progress; restarting the server never resumes calls automatically. Contract correctness, commercial correctness and human review remain separate.

## Releases

Pull requests and pushes to `main` run checks. They do not deploy. A release is created by pushing a new immutable `vX.Y.Z` tag from `main`:

```sh
git fetch origin main
git switch main
git pull --ff-only origin main
git tag -a v0.0.1 -m 'v0.0.1'
git push origin v0.0.1
```

GitHub Actions checks the tag, publishes its Docker image to GHCR, and asks Dokploy to deploy the exact image digest. See [deployment.md](docs/deployment.md) for Dokploy setup, GitHub secrets, persistence checks and rollback notes.
