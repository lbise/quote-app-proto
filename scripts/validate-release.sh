#!/usr/bin/env sh
set -eu

usage() {
  printf 'Usage: %s vX.Y.Z\n' "$0" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
TAG=$1

case "$TAG" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *)
    printf 'Release tag must have the exact form vX.Y.Z: %s\n' "$TAG" >&2
    exit 1
    ;;
esac

if ! printf '%s\n' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  printf 'Release tag must have the exact form vX.Y.Z: %s\n' "$TAG" >&2
  exit 1
fi

git rev-parse --verify --quiet "refs/tags/$TAG^{commit}" >/dev/null || {
  printf 'Tag does not resolve to a commit: %s\n' "$TAG" >&2
  exit 1
}

git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main

if ! git merge-base --is-ancestor "refs/tags/$TAG^{commit}" origin/main; then
  printf 'Release tag commit is not reachable from origin/main: %s\n' "$TAG" >&2
  exit 1
fi

printf 'Validated release tag %s on origin/main\n' "$TAG"
