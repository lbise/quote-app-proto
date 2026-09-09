#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SCRIPT="$ROOT/scripts/validate-release.sh"
TMP=$(mktemp -d)
server_pid=
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

remote="$TMP/remote.git"
repo="$TMP/repo"
git init --bare "$remote" >/dev/null
git init -b main "$repo" >/dev/null
(
  cd "$repo"
  git config user.email test@example.com
  git config user.name test
  printf 'first\n' > file
  git add file
  git commit -m first >/dev/null
  git remote add origin "$remote"
  git push -u origin main >/dev/null
  git tag -a v1.2.3 -m 'test release'
  "$SCRIPT" v1.2.3 >/dev/null

  if "$SCRIPT" v1.2 >/dev/null 2>&1; then
    printf 'Malformed release tag passed validation\n' >&2
    exit 1
  fi

  git switch -c release-only >/dev/null
  printf 'second\n' >> file
  git commit -am second >/dev/null
  git tag -a v1.2.4 -m 'non-main release'
  if "$SCRIPT" v1.2.4 >/dev/null 2>&1; then
    printf 'Release tag outside main passed validation\n' >&2
    exit 1
  fi
)

if DOKPLOY_URL=https://dokploy.example.test \
  DOKPLOY_TOKEN=test \
  DOKPLOY_APPLICATION_ID=test \
  "$ROOT/scripts/deploy-dokploy.sh" ghcr.io/example/easy-quote:v1.2.3 >/dev/null 2>&1; then
  printf 'Mutable image reference passed deployment validation\n' >&2
  exit 1
fi

image='ghcr.io/example/easy-quote@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$TMP/key.pem" -out "$TMP/certificate.pem" \
  -subj '/CN=127.0.0.1' \
  -addext 'subjectAltName = IP:127.0.0.1' >/dev/null 2>&1
node "$ROOT/tests/deployment/mock-dokploy-server.mjs" \
  "$TMP/key.pem" "$TMP/certificate.pem" "$image" >"$TMP/port" 2>"$TMP/server.err" &
server_pid=$!
for _ in $(seq 1 20); do
  [ -s "$TMP/port" ] && break
  sleep 1
done
[ -s "$TMP/port" ] || { cat "$TMP/server.err" >&2; exit 1; }
port=$(cat "$TMP/port")
CURL_CA_BUNDLE="$TMP/certificate.pem" \
  DOKPLOY_URL="https://127.0.0.1:$port" \
  DOKPLOY_TOKEN=test-token \
  DOKPLOY_APPLICATION_ID=test-app \
  "$ROOT/scripts/deploy-dokploy.sh" "$image" >/dev/null

printf 'Deployment script validation tests passed\n'
