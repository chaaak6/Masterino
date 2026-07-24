#!/usr/bin/env bash
set -euo pipefail
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

ACK_CLUSTER_ID="${ACK_CLUSTER_ID:-c23ea84b986c446d5b3fa9227962e77f4}"
ACK_CONTEXT="${ACK_CONTEXT:-ack-c23ea84b-masterlion-test}"
ACK_PRIVATE_IP_ADDRESS="${ACK_PRIVATE_IP_ADDRESS:-true}"
ACK_KUBECONFIG_MINUTES="${ACK_KUBECONFIG_MINUTES:-120}"
ACK_TEST_ACTION="${ACK_TEST_ACTION:-validate}"
NAMESPACE="masterino-test"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" > /dev/null 2>&1 || fail "required command is missing: $1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required CI private variable is missing: $name"
  [[ "${!name}" != *$'\n'* && "${!name}" != *$'\r'* ]] \
    || fail "$name must not contain a line break"
}

require_digest() {
  local name="$1"
  require_env "$name"
  [[ "${!name}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "$name must be an immutable sha256 digest"
}

cleanup() {
  set +e
  [[ -n "${KUBECONFIG_FILE:-}" ]] && rm -f -- "$KUBECONFIG_FILE"
  [[ -n "${ACK_RESPONSE_FILE:-}" ]] && rm -f -- "$ACK_RESPONSE_FILE"
  [[ -n "${APP_SECRET_FILE:-}" ]] && rm -f -- "$APP_SECRET_FILE"
  [[ -n "${BRIDGE_SECRET_FILE:-}" ]] && rm -f -- "$BRIDGE_SECRET_FILE"
  [[ -n "${TEMP_DIR:-}" ]] && rmdir -- "$TEMP_DIR" 2> /dev/null
}

write_env() {
  local file="$1" name="$2" value="$3"
  printf '%s=%s\n' "$name" "$value" >> "$file"
}

prepare_kubeconfig() {
  require_command aliyun
  require_command jq
  require_command kubectl

  case "$ACK_PRIVATE_IP_ADDRESS" in
    true | false) ;;
    *) fail "ACK_PRIVATE_IP_ADDRESS must be true or false" ;;
  esac
  [[ "$ACK_KUBECONFIG_MINUTES" =~ ^[0-9]+$ ]] \
    || fail "ACK_KUBECONFIG_MINUTES must be an integer"
  ((ACK_KUBECONFIG_MINUTES >= 15 && ACK_KUBECONFIG_MINUTES <= 4320)) \
    || fail "ACK_KUBECONFIG_MINUTES must be between 15 and 4320"

  aliyun cs GET \
    "/k8s/${ACK_CLUSTER_ID}/user_config?PrivateIpAddress=${ACK_PRIVATE_IP_ADDRESS}&TemporaryDurationMinutes=${ACK_KUBECONFIG_MINUTES}" \
    > "$ACK_RESPONSE_FILE"
  jq -er '.config | select(length > 0)' "$ACK_RESPONSE_FILE" > "$KUBECONFIG_FILE"
  chmod 600 "$KUBECONFIG_FILE"

  local current_context
  current_context="$(kubectl --kubeconfig "$KUBECONFIG_FILE" config current-context)"
  [[ -n "$current_context" ]] || fail "ACK returned a kubeconfig without a current context"
  if [[ "$current_context" != "$ACK_CONTEXT" ]]; then
    kubectl --kubeconfig "$KUBECONFIG_FILE" config \
      rename-context "$current_context" "$ACK_CONTEXT" > /dev/null
  fi

  export KUBECONFIG="$KUBECONFIG_FILE"
  export ACK_CONTEXT
  export ACK_API_SERVER
  ACK_API_SERVER="$(
    kubectl --kubeconfig "$KUBECONFIG_FILE" config view --minify --raw \
      -o jsonpath='{.clusters[0].cluster.server}'
  )"
  [[ -n "$ACK_API_SERVER" ]] || fail "ACK kubeconfig does not contain an API server"
}

prepare_secret_files() {
  local required=(
    KEY_VAULTS_SECRET
    AUTH_SECRET
    JWKS_KEY
    POSTGRES_PASSWORD
    REDIS_PASSWORD
    S3_ACCESS_KEY_ID
    S3_SECRET_ACCESS_KEY
    AIHUB_BRIDGE_TOKEN
    QSTASH_TOKEN
    QSTASH_CURRENT_SIGNING_KEY
    QSTASH_NEXT_SIGNING_KEY
    AIHUB_READONLY_DATABASE_URL
  )
  local name
  for name in "${required[@]}"; do
    require_env "$name"
  done

  [[ "$AUTH_SECRET" =~ ^[0-9a-fA-F]{64}$ ]] \
    || fail "AUTH_SECRET must be 64 hexadecimal characters"
  [[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] \
    || fail "POSTGRES_PASSWORD must be URL-safe"
  [[ "$REDIS_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] \
    || fail "REDIS_PASSWORD must be URL-safe"
  local key_vault_bytes
  key_vault_bytes="$(
    printf '%s' "$KEY_VAULTS_SECRET" | base64 --decode 2> /dev/null | wc -c
  )" || fail "KEY_VAULTS_SECRET must be valid base64"
  [[ "$key_vault_bytes" -eq 32 ]] \
    || fail "KEY_VAULTS_SECRET must decode to exactly 32 bytes"
  printf '%s' "$JWKS_KEY" | jq -e \
    '.keys | length > 0 and (.[0] | .kty == "RSA" and .alg == "RS256" and .use == "sig" and .d != null)' \
    > /dev/null || fail "JWKS_KEY must contain an RSA private JWKS"

  : > "$APP_SECRET_FILE"
  write_env "$APP_SECRET_FILE" KEY_VAULTS_SECRET "$KEY_VAULTS_SECRET"
  write_env "$APP_SECRET_FILE" AUTH_SECRET "$AUTH_SECRET"
  write_env "$APP_SECRET_FILE" JWKS_KEY "$JWKS_KEY"
  write_env "$APP_SECRET_FILE" POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  write_env "$APP_SECRET_FILE" DATABASE_URL \
    "postgresql://postgres:${POSTGRES_PASSWORD}@masterino-postgres:5432/lobechat"
  write_env "$APP_SECRET_FILE" REDIS_PASSWORD "$REDIS_PASSWORD"
  write_env "$APP_SECRET_FILE" REDIS_URL \
    "redis://:${REDIS_PASSWORD}@masterino-redis:6379/0"
  write_env "$APP_SECRET_FILE" S3_ACCESS_KEY "$S3_ACCESS_KEY_ID"
  write_env "$APP_SECRET_FILE" S3_ACCESS_KEY_ID "$S3_ACCESS_KEY_ID"
  write_env "$APP_SECRET_FILE" S3_SECRET_ACCESS_KEY "$S3_SECRET_ACCESS_KEY"
  write_env "$APP_SECRET_FILE" AIHUB_BRIDGE_TOKEN "$AIHUB_BRIDGE_TOKEN"
  write_env "$APP_SECRET_FILE" QSTASH_TOKEN "$QSTASH_TOKEN"
  write_env "$APP_SECRET_FILE" QSTASH_CURRENT_SIGNING_KEY "$QSTASH_CURRENT_SIGNING_KEY"
  write_env "$APP_SECRET_FILE" QSTASH_NEXT_SIGNING_KEY "$QSTASH_NEXT_SIGNING_KEY"
  write_env "$APP_SECRET_FILE" AUTH_SSO_PROVIDERS "${AUTH_SSO_PROVIDERS:-wecom}"

  : > "$BRIDGE_SECRET_FILE"
  write_env "$BRIDGE_SECRET_FILE" AIHUB_BRIDGE_TOKEN "$AIHUB_BRIDGE_TOKEN"
  write_env "$BRIDGE_SECRET_FILE" AIHUB_READONLY_DATABASE_URL \
    "$AIHUB_READONLY_DATABASE_URL"
  chmod 600 "$APP_SECRET_FILE" "$BRIDGE_SECRET_FILE"
}

require_command bash
require_command base64
require_command mktemp
require_command wc

TEMP_DIR="$(mktemp -d)"
KUBECONFIG_FILE="$TEMP_DIR/kubeconfig"
ACK_RESPONSE_FILE="$TEMP_DIR/ack-response.json"
APP_SECRET_FILE="$TEMP_DIR/secret.env"
BRIDGE_SECRET_FILE="$TEMP_DIR/bridge-secret.env"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT_DIR"
prepare_kubeconfig

case "$ACK_TEST_ACTION" in
  preflight)
    bash ./deploy.sh --env test preflight
    ;;
  validate)
    require_digest MASTERLION_IMAGE_DIGEST
    require_digest BRIDGE_IMAGE_DIGEST
    export MASTERLION_IMAGE_DIGEST BRIDGE_IMAGE_DIGEST
    bash ./deploy.sh --env test preflight
    bash ./deploy.sh --env test validate
    ;;
  deploy)
    [[ "${CONFIRM_ACK_TEST_DEPLOY:-}" == "$NAMESPACE" ]] \
      || fail "set CONFIRM_ACK_TEST_DEPLOY=$NAMESPACE to authorize a test deployment"
    require_digest MASTERLION_IMAGE_DIGEST
    require_digest BRIDGE_IMAGE_DIGEST
    export MASTERLION_IMAGE_DIGEST BRIDGE_IMAGE_DIGEST
    bash ./deploy.sh --env test preflight
    bash ./deploy.sh --env test validate
    prepare_secret_files
    bash ./deploy.sh --env test bootstrap
    bash ./deploy.sh --env test create-secret "$APP_SECRET_FILE" "$BRIDGE_SECRET_FILE"
    bash ./deploy.sh --env test deploy
    bash ./deploy.sh --env test rollout
    ;;
  status)
    bash ./deploy.sh --env test status
    ;;
  *)
    fail "ACK_TEST_ACTION must be preflight, validate, deploy, or status"
    ;;
esac
