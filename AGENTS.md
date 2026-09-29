## Tests

Database-backed tests read `TEST_DATABASE_URL` from `.env`. Never set it to the `DATABASE_URL` database; the test setup refuses. After adding a migration, apply it to the test database too: `DATABASE_URL=<TEST_DATABASE_URL> npm run db:migrate`. See `docs/quote-workflow.md`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
