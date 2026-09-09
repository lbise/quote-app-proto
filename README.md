# Easy Quote

Easy Quote is a prototype for small artisan businesses preparing customer quotes.

The current slice provides bilingual email/password authentication for selected testers and a protected starter page. Quote and Customer workflows are intentionally not included yet.

## Run locally

Use Node.js 24 and Docker Compose.

Start the local PostgreSQL service, install dependencies and apply the migration. Compose binds PostgreSQL to localhost only and uses trust authentication because this database is disposable local development data, not a production service:

```sh
docker compose up -d postgres
npm ci
cp .env.example .env
npm run db:migrate
```

Start the development server on localhost with `npm run dev`, or bind it to the machine's private interfaces with `npm run dev:network`. Server-side development commands load `.env`; the file is ignored by Git and excluded from Docker images. Production uses runtime environment variables instead.

The example environment uses captured mail (`EMAIL_DELIVERY=fake`) and `AUTH_ALLOWED_EMAILS=*`, so local development never sends real messages. Captured messages are held in the server process and are not exposed by an application endpoint. Use a specific address instead of `*` when testing the allowlist behavior.

Open `http://localhost:5173` to sign in or register. For a headless machine, start the server on its private interfaces instead:

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
