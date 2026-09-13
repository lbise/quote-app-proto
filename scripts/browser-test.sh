#!/usr/bin/env bash
set -euo pipefail

npm exec tsx scripts/browser-test-setup.ts
exec npx playwright test "$@"
