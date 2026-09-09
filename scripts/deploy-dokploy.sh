#!/usr/bin/env sh
set -eu

require() {
  eval "value=\${$1-}"
  if [ -z "$value" ]; then
    printf 'Missing required environment variable: %s\n' "$1" >&2
    exit 2
  fi
}

require DOKPLOY_URL
require DOKPLOY_TOKEN
require DOKPLOY_APPLICATION_ID

if [ "$#" -ne 1 ]; then
  printf 'Usage: %s ghcr.io/owner/image@sha256:<64-hex-digest>\n' "$0" >&2
  exit 2
fi

IMAGE=$1
case "$DOKPLOY_URL" in
  https://*) ;;
  *)
    printf 'DOKPLOY_URL must use HTTPS\n' >&2
    exit 2
    ;;
esac

if ! printf '%s\n' "$IMAGE" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$'; then
  printf 'Image must be a lowercase GHCR digest reference\n' >&2
  exit 2
fi

BASE_URL=${DOKPLOY_URL%/}
# Dokploy v0.19+ personal API keys use x-api-key, not legacy bearer auth.
AUTHORIZATION="x-api-key: $DOKPLOY_TOKEN"

api_get() {
  curl --fail --silent --show-error \
    --header 'Accept: application/json' \
    --header "$AUTHORIZATION" \
    --connect-timeout 10 --max-time 30 \
    "$BASE_URL/api/$1" || {
      printf 'Dokploy GET %s failed; response body withheld.\n' "${1%%\?*}" >&2
      return 1
    }
}

api_post() {
  printf '%s' "$2" | curl --fail --silent --show-error \
    --request POST \
    --header 'Accept: application/json' \
    --header 'Content-Type: application/json' \
    --header "$AUTHORIZATION" \
    --data-binary @- \
    --connect-timeout 10 --max-time 30 \
    "$BASE_URL/api/$1" >/dev/null || {
      printf 'Dokploy POST %s failed; response body withheld.\n' "$1" >&2
      return 1
    }
}

# Read the application before changing it. Do not print this response: it can
# include Dokploy configuration that does not belong in CI logs.
application=$(api_get "application.one?applicationId=$DOKPLOY_APPLICATION_ID")
before=$(api_get "deployment.all?applicationId=$DOKPLOY_APPLICATION_ID")
before_ids=$(printf '%s' "$before" | jq -c '[.[].deploymentId]')

# saveDockerProvider requires all registry fields and overwrites them. Preserve
# the saved credentials, including nulls for public images. Never log this body.
provider_payload=$(printf '%s' "$application" | jq -ce \
  --arg applicationId "$DOKPLOY_APPLICATION_ID" \
  --arg dockerImage "$IMAGE" '
  if has("username") and has("password") and has("registryUrl") then
    {applicationId: $applicationId, dockerImage: $dockerImage,
     username, password, registryUrl}
  else error("Application response lacks registry fields; refusing to overwrite credentials")
  end')
api_post 'application.saveDockerProvider' "$provider_payload"

configured=$(api_get "application.one?applicationId=$DOKPLOY_APPLICATION_ID")
if ! printf '%s' "$configured" | jq -e --arg image "$IMAGE" \
  '.sourceType == "docker" and .dockerImage == $image' >/dev/null; then
  printf 'Dokploy did not retain the requested Docker digest\n' >&2
  exit 1
fi

deploy_payload=$(jq -cn --arg applicationId "$DOKPLOY_APPLICATION_ID" \
  '{applicationId: $applicationId}')
api_post 'application.deploy' "$deploy_payload"

# Dokploy creates a deployment record asynchronously. Its public API exposes
# the record status, so wait for the record created by this invocation.
attempt=0
while [ "$attempt" -lt 60 ]; do
  deployments=$(api_get "deployment.all?applicationId=$DOKPLOY_APPLICATION_ID")
  status=$(printf '%s' "$deployments" | jq -r --argjson before "$before_ids" '
    map(select(.deploymentId as $id | ($before | index($id) | not)))
    | .[0].status // empty
  ')

  case "$status" in
    done)
      printf 'Dokploy deployment completed for %s\n' "$IMAGE"
      exit 0
      ;;
    error|cancelled)
      printf 'Dokploy reports the deployment as %s\n' "$status" >&2
      exit 1
      ;;
    '') ;;
    running) ;;
    *)
      printf 'Dokploy returned an unknown deployment status\n' >&2
      exit 1
      ;;
  esac

  attempt=$((attempt + 1))
  sleep 5
done

printf 'Timed out waiting for Dokploy deployment status\n' >&2
exit 1
