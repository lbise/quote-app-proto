# Deployment

Easy Quote ships only from a pushed release tag. Pull requests and pushes to `main` run checks. They do not publish an image or contact Dokploy.

The release image is `ghcr.io/<owner>/quote-app-proto:vX.Y.Z`. The deploy job passes Dokploy the matching digest reference, such as `ghcr.io/<owner>/quote-app-proto@sha256:...`. It never deploys `latest` or a version tag.

## Runtime contract

The Docker image uses Node 24 and installs the complete dependency set. It builds with `npm run build`, then starts with:

```sh
npm run db:migrate && exec npm run start
```

The application must provide these scripts:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run db:migrate`
- `npm run start`

`start` must listen on `0.0.0.0:3000`. The image provides `HOST=0.0.0.0` and `PORT=3000`. It exposes port 3000 and uses `/health/ready` for its Docker health check. The application must also provide `/health/live`. `/health/live` only reports that the process can answer HTTP. `/health/ready` must check PostgreSQL connectivity and that the required schema exists.

The image contains no runtime secrets. Set the following only in Dokploy's application environment, as runtime secrets or configuration. Do not add them as Docker build arguments, GitHub Actions secrets used during the build, or checked-in environment files:

- `DATABASE_URL`: PostgreSQL connection string.
- `BETTER_AUTH_SECRET`: at least 32 random characters.
- `BETTER_AUTH_URL`: the canonical HTTPS application URL (`https://easy-quote.voidstation.ch` in production); it is used for origin checks and verification/reset links.
- `REGISTRATION_MODE`: optional, `invitation` (the default) or `open`. With `invitation`, people can sign up only through an Administrator's invitation link (see [Administrators](#administrators)). With `open`, anyone can sign up and becomes an active User once their email is verified; there is no approval step, and blocking is the only moderation. The admin area cannot change it: opening registration is a deliberate launch step (#46). Any other value stops the server at startup. It does not control access after sign-up: a signed-up User keeps access until an Administrator blocks them.
- `ADMIN_EMAILS`: optional, space, comma or newline separated emails whose Users are always Administrators (see [Administrators](#administrators)). `*` is ignored.
- `AUTH_TRUSTED_ORIGINS`: optional additional HTTPS origins, space separated. Include `https://dev.voidstation.ch` when serving the development deployment from that domain.
- `EMAIL_DELIVERY=smtp`, `SMTP_HOST=mail.infomaniak.com`, `SMTP_PORT=587`, `SMTP_USER=auth@voidstation.ch`, `SMTP_PASSWORD` (dedicated device/app password), and `SMTP_FROM=auth@voidstation.ch`.

For the current production deployment, use:

```env
BETTER_AUTH_URL=https://easy-quote.voidstation.ch
AUTH_TRUSTED_ORIGINS=https://easy-quote.voidstation.ch https://dev.voidstation.ch
SMTP_USER=auth@voidstation.ch
SMTP_FROM=auth@voidstation.ch
```

Optional, for demo accounts (see [Demo accounts](#demo-accounts)):

- `DEMO_ACCOUNTS`: space-separated `email:password` entries. Keep it as a runtime secret. Passwords are 8 to 128 characters and cannot contain spaces.

For local development, `EMAIL_DELIVERY=fake` captures messages in memory and never sends mail. The example `.env` opens registration; do not copy that to a deployment before launch.

This first slice runs one application replica. The container migrates before it serves traffic, so two replicas can race on migrations. Before scaling, move migrations into a one-shot release step or add a migration lock, and set the service to start only after that step succeeds.

## CI and release flow

`.github/workflows/checks.yml` runs on pull requests targeting `main` and pushes to `main`:

1. starts PostgreSQL 16;
2. sets `TEST_DATABASE_URL` to its local connection string;
3. runs `npm ci`, typecheck, test, and build;
4. installs Chromium and runs the Quote browser suite against a separate test database;
5. runs the deployment-script tests.

The database integration test uses `TEST_DATABASE_URL`. The workflow applies the committed migration to that database before running the test suite. Local runs without `TEST_DATABASE_URL` still cover health success/failure paths with injected adapters and pure Quote calculations. Authenticated Quote persistence tests require real PostgreSQL and are skipped without that variable.

`.github/workflows/release.yml` runs only for pushed tags matching GitHub's broad `v*` filter. Its validator then rejects every value except `vX.Y.Z` with numeric X, Y, and Z. A full checkout fetches `origin/main` and rejects a tag whose target commit is not reachable from it. The release job repeats the same PostgreSQL-backed checks before publishing.

Before publishing, the workflow requests the GHCR manifest for `ghcr.io/<owner>/quote-app-proto:vX.Y.Z`. HTTP 200 fails the release, HTTP 404 permits it, and any other response fails closed. This prevents replacing a published release version even if the Git tag was deleted and recreated. Protect `v*` tags in GitHub as well, so only maintainers can create them.

The publish job has `packages: write`. Check jobs only have `contents: read`. The deploy job uses the production GitHub Environment and has no package permission. Deployments share the `production-deploy` concurrency group with `cancel-in-progress: false`, because interrupting a migration is unsafe.

## Dokploy setup

Do these steps in Dokploy and GitHub before the first release. They are human setup steps. This repository does not create or change VPS resources.

1. Create a PostgreSQL service in the Easy Quote Dokploy project.
2. Add a Docker-managed volume to PostgreSQL at its image's data directory. For the standard Postgres image this is `/var/lib/postgresql/data`.
3. Put PostgreSQL and the Easy Quote application on the same private Dokploy network. Do not publish PostgreSQL's port. The application `DATABASE_URL` must use the database's private hostname and port on that network. Keep PostgreSQL private.
4. Create an application with the Docker provider. Give Dokploy credentials that can pull the private GHCR package, if the package is private. Do not enable a Git or Docker webhook or Dokploy auto-deploy for this application.
5. Configure the application to target port 3000 and route its domain through Dokploy. Configure its health check to request `/health/ready` on port 3000 if the Dokploy version exposes that setting.
6. Set the runtime contract above in the application's Dokploy environment. Keep `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `SMTP_PASSWORD` as runtime secrets, not in the repository or image build. Start with `EMAIL_DELIVERY=fake` while validating the deployment; switch to authenticated Infomaniak SMTP only after the mailbox, DNS and sending allowance checks are complete.
7. Create a Dokploy API key with access limited to this application. It needs to read the application and deployments, update the application Docker provider, and create deployments.
8. In the GitHub `production` environment, add `DOKPLOY_URL`, `DOKPLOY_TOKEN`, and `DOKPLOY_APPLICATION_ID` as secrets. `DOKPLOY_URL` must be an HTTPS base URL with no `/api` suffix. Protect the environment with the intended reviewer policy.
9. Give the repository Actions package write access and configure the GHCR package so Dokploy can pull it.

The release script requires Dokploy v0.19+ and sends the personal API key in the `x-api-key` header. Set `DOKPLOY_TOKEN` to the raw key, without a `Bearer` prefix. It calls these Dokploy API operations:

- `GET /api/application.one?applicationId=...` before and after the change;
- `POST /api/application.saveDockerProvider` with `applicationId`, the immutable `dockerImage` digest, and the existing `username`, `password` and `registryUrl` from `application.one`. All registry fields are required, even when null. Preserve their values to avoid clearing private-registry credentials;
- `POST /api/application.deploy` with `applicationId`;
- `GET /api/deployment.all?applicationId=...` until the new record is `done`, `error`, or `cancelled`.

It does not use the mutable webhook. It does not print Dokploy API responses, because an application response can contain configuration that does not belong in an Actions log. The deployment poll is API status verification, not an HTTP readiness test. After the first deployment, request `https://<application-domain>/health/live` and `/health/ready` and confirm both return 200.

Dokploy sources used to verify the API and settings:

- [Dokploy API guide](https://docs.dokploy.com/docs/api), which shows the `x-api-key` authentication header.
- [Dokploy authentication implementation](https://github.com/Dokploy/dokploy/blob/canary/packages/server/src/lib/auth.ts), which reads and verifies `x-api-key`.
- [Dokploy OpenAPI generator](https://github.com/Dokploy/dokploy/blob/canary/apps/dokploy/scripts/generate-openapi.ts), which defines the API-key header. Older examples using bearer authentication predate personal API keys.
- [Dokploy provider request schema](https://github.com/Dokploy/dokploy/blob/bda81242917e3bb7db4a755634fabd4fefc8c2c7/packages/server/src/db/schema/application.ts#L508-L516) and [handler](https://github.com/Dokploy/dokploy/blob/bda81242917e3bb7db4a755634fabd4fefc8c2c7/apps/dokploy/server/api/routers/application.ts#L644-L657), which require and overwrite all Docker provider fields.
- [Dokploy deployment schema](https://github.com/Dokploy/dokploy/blob/canary/packages/server/src/db/schema/deployment.ts), which defines `running`, `done`, `error`, and `cancelled` deployment status values.
- [Dokploy database guide](https://docs.dokploy.com/docs/core/databases/overview) and [application volume guide](https://docs.dokploy.com/docs/core/application/advanced), which document volume configuration and database backups.

## Releasing and rollback

Create a release only from current `main`:

```sh
git fetch origin main
git switch main
git pull --ff-only origin main
git tag -a v1.2.3 -m 'v1.2.3'
git push origin v1.2.3
```

Watch the Release workflow. A failed check leaves GHCR and Dokploy untouched. A failed publish leaves Dokploy untouched. A failed Dokploy status poll means inspect the Dokploy deployment logs before retrying. The tag remains immutable, so do not retry by moving it. If only a GitHub secret needs correcting, rerun the failed deploy job. If the deployment script needs a code fix, merge it into `main` and push the next version tag. Rerunning an old release still checks out its old script; rerunning all jobs also fails the existing-image check.

To roll back, choose the recorded digest of a known-good release and save that digest in the Dokploy Docker provider, then deploy it. The release workflow prints that digest in the deploy job. An image rollback does not roll back PostgreSQL. Take a database backup before releases that include migrations, use backward-compatible expand and contract migrations, and write a separate database recovery plan before any destructive migration.

Before real data, prove persistence: create test data, redeploy the application, and verify the data remains. Also restore a PostgreSQL backup into an isolated database and verify the restored data. A volume surviving an application redeploy is necessary, but it is not a backup test.

## Demo accounts

`npm run seed:demo` creates verified demo accounts with an empty Artisan Business. It sends no email. Run it separately in each deployment (production and `dev.voidstation.ch`), because each has its own database.

1. In the Dokploy application environment, set `DEMO_ACCOUNTS`, for example `demo1@voidstation.ch:first-password demo2@voidstation.ch:second-password`, Demo accounts need no invitation. Redeploy so the container receives the new environment.
2. Open the application's container terminal in Dokploy and run `npm run seed:demo`. It prints `created` or `unchanged` for each email, never a password.
3. To empty the demo accounts again, for example before handing them to another prospect, run `npm run seed:demo -- --reset`. This deletes each listed demo account with its Customers, Quotes, settings and logo, signs out its sessions, and recreates it empty with the password currently in `DEMO_ACCOUNTS`. Change a demo password by editing `DEMO_ACCOUNTS`, redeploying, and resetting.

The command marks the accounts it creates in the `demo_account` table and only ever resets marked accounts. If a listed email belongs to a real account, it stops before changing anything. Removing an email from `DEMO_ACCOUNTS` leaves the account in place; block it in the admin area to stop sign-in. A reset recreates the account unblocked.

## Administrators

Administrators open the admin area at `/admin` from the navigation. Everyone else gets a not-found page there. The area lists every User with their status, Administrator role, Artisan Business and creation date. An Administrator can block, unblock, grant the Administrator role and remove it, and invite people. Every such change, and every invitation sent, resent or cancelled, is recorded with the acting Administrator, the User or invited email, the action and the time, and kept indefinitely.

- Blocking ends all of the User's sessions at once and refuses sign-in. An Assistant Turn already running is allowed to finish. The User's Artisan Business, Quotes and Customers are kept, and unblocking restores access to them.
- Users whose email is in `ADMIN_EMAILS` are Bootstrap Administrators: always Administrators, and never blocked, even if they were blocked before being listed. The admin area cannot block them or remove their role. Use it to create the first Administrator, and as the way back in if every other Administrator is lost: add an email, redeploy, and sign up or sign in with it.
- An Administrator cannot block themselves or remove their own role. The last active Administrator granted in the admin area cannot be blocked or have their role removed.
- **Invite** sends an email with a link to `/sign-up?invitation=…`, optionally granting the Administrator role up front. The invitee signs up there with the email filled in and locked, sets their own password, and verifies their email as usual. A link is tied to its email, works once, and expires after 7 days. Resending sends a new link valid for 7 days and makes the previous one stop working; cancelling makes the link stop working. An email that already belongs to a User, or already has a pending invitation, cannot be invited. Pending, expired and cancelled invitations are listed with the Users; once accepted, the invitation is replaced by its User. If the email cannot be sent, nothing is saved.
- The sign-up page tells the person that Administrators can read their Quotes and conversations, and that Turn Traces are kept for up to 30 days (ADR 0007).
- The Administrator writes the invitation email's subject and message when inviting. The form starts from the default text: a French then an English part, because the invitee's language is not known yet, each saying who is invited (as an Administrator or not), where the link is, that it is valid for 7 days and works once, and to ignore the email if unexpected. It does not repeat what Administrators can read. Each `{lien}` in the message becomes the invitation link; a message without one gets the link at the end. The subject is one line of at most 200 characters, and the message at most 5,000 characters. Resending sends the same subject and message with the new link.
- An invitation also applies when registration is open: an invited email that signs up without the link still gets the role it was invited with.

The admin area also lets Administrators inspect every Artisan Business, read-only (#53). Nothing in these views edits a Quote, runs the assistant, publishes, archives, deletes or signs in as another User.

- **Businesses** (`/admin/businesses`): one row per Artisan Business with its owner, the owner's status, its active and Archived Quote counts, and its last activity, which is the latest Assistant Turn or Quote change. A business opens on all its Quotes, Archived Quotes included.
- **A Quote** (`/admin/quotes/:id`): its Working Draft and each Published Revision as the PDF prints them, and its conversation. Each Assistant Turn links to its Turn Trace, or says that the trace expired. The shown version downloads as a Draft Preview or Quote Document from `/admin/quotes/:id/draft-preview` and `/admin/quotes/:id/revisions/:number/document`.
- **Assistant Turns** (`/admin/turns`): every Assistant Turn with a Turn Trace, newest first, 50 per page. Each row shows the time, User, business, Quote, outcome, model, model calls, tokens and cost. Filters: outcome, User, and a date range in Swiss days, both ends included. The list can also be limited to one Quote.
- **A Turn Trace** (`/admin/turns/:id`): a stable URL for problem reports (#45). It shows the model calls, tool calls and tool results in order, with each model call's model, tokens, cost and latency. Every payload and response opens as the JSON recorded and can be copied. A trace that expired or went with its Quote shows a not-found page that says so.

The outcomes are: committed; committed with failed calls (a tool call was rejected along the way); unchanged; discarded; provider error (the last model call sent failed or ended in a provider error); and failed before any model call (no call reached the provider, for example a stale Working Draft or the spending limit).

## Local checks

After the application package exists:

```sh
npm ci
npm run typecheck
npm run test
npm run build
sh tests/deployment/validate-release.test.sh
docker build -t easy-quote:local .
```

Run the container with a disposable PostgreSQL `DATABASE_URL`. Confirm `npm run db:migrate` finishes before the server starts, and query both health URLs on port 3000.
