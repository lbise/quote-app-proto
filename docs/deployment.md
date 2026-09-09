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
- `AUTH_ALLOWED_EMAILS`: space, comma or newline separated normalized tester addresses. An empty value denies all new registrations and protected access.
- `AUTH_TRUSTED_ORIGINS`: optional additional HTTPS origins, space separated.
- `EMAIL_DELIVERY=smtp`, `SMTP_HOST=mail.infomaniak.com`, `SMTP_PORT=587`, `SMTP_USER=auth@voidstation.ch`, `SMTP_PASSWORD` (dedicated device/app password), and `SMTP_FROM=auth@voidstation.ch`.

For the current production deployment, use:

```env
BETTER_AUTH_URL=https://easy-quote.voidstation.ch
AUTH_TRUSTED_ORIGINS=https://easy-quote.voidstation.ch
SMTP_USER=auth@voidstation.ch
SMTP_FROM=auth@voidstation.ch
```

For local development, `EMAIL_DELIVERY=fake` captures messages in memory and never sends mail. Do not use `AUTH_ALLOWED_EMAILS=*` outside disposable local development.

This first slice runs one application replica. The container migrates before it serves traffic, so two replicas can race on migrations. Before scaling, move migrations into a one-shot release step or add a migration lock, and set the service to start only after that step succeeds.

## CI and release flow

`.github/workflows/checks.yml` runs on pull requests targeting `main` and pushes to `main`:

1. starts PostgreSQL 16;
2. sets `TEST_DATABASE_URL` to its local connection string;
3. runs `npm ci`, typecheck, test, and build;
4. runs the deployment-script tests.

The database integration test uses `TEST_DATABASE_URL`. The workflow applies the committed migration to that database before running the test suite. Local runs without `TEST_DATABASE_URL` still cover the success and failure paths with injected database adapters.

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
