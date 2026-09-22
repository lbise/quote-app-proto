#!/usr/bin/env bash
set -euo pipefail

# This script owns one disposable local PostgreSQL container. It never reads or
# uses DATABASE_URL, so an application database cannot become an eval target.
container="${EVAL_DB_CONTAINER:-easy-quote-eval}"
port="${EVAL_DB_PORT:-55434}"
user="quote_evaluation"
database="quote_evaluation"
password="quote_evaluation_local_only"
url="postgresql://${user}:${password}@127.0.0.1:${port}/${database}"

case "${1:-}" in
  up)
    if docker inspect "$container" >/dev/null 2>&1; then
      echo "Evaluation database container already exists: $container" >&2
      exit 1
    fi
    docker run --detach --rm --name "$container" \
      --label easy-quote.evaluation=true \
      --publish "127.0.0.1:${port}:5432" \
      --env POSTGRES_USER="$user" \
      --env POSTGRES_PASSWORD="$password" \
      --env POSTGRES_DB="$database" \
      postgres:16-alpine >/dev/null
    for _ in $(seq 1 30); do
      if docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if ! docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null 2>&1; then
      echo "Evaluation PostgreSQL did not become ready." >&2
      docker stop "$container" >/dev/null || true
      exit 1
    fi
    # Production mode disables the migration module's dotenv autoload. This
    # child gets only the dedicated container URL.
    env -u DATABASE_URL NODE_ENV=production DATABASE_URL="$url" npm run db:migrate
    printf 'export EVAL_DATABASE_URL=%q\n' "$url"
    ;;
  url)
    if ! docker inspect "$container" >/dev/null 2>&1; then
      echo "Evaluation database container is not running: $container" >&2
      exit 1
    fi
    printf '%s\n' "$url"
    ;;
  down)
    if ! docker inspect "$container" >/dev/null 2>&1; then
      echo "Evaluation database container is not running: $container" >&2
      exit 1
    fi
    label="$(docker inspect --format '{{ index .Config.Labels "easy-quote.evaluation" }}' "$container")"
    if [[ "$label" != "true" ]]; then
      echo "Refusing to stop a container not created for evaluation." >&2
      exit 1
    fi
    docker stop "$container" >/dev/null
    ;;
  *)
    echo "Usage: scripts/eval-db.sh {up|url|down}" >&2
    exit 2
    ;;
esac
