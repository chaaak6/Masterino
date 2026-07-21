#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ACK_CLUSTER_ID="c23ea84b986c446d5b3fa9227962e77f4"
PRODUCTION_ACK_CLUSTER_ID="c5c81a41c33164f578f4e43a77fda5fc3"
EXPECTED_ACK_REGION="cn-shenzhen"
DEFAULT_TEST_CONTEXT="ack-c23ea84b-masterlion-test"
MASTERLION_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion"
BRIDGE_IMAGE="boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion-aihub-db-bridge"
IMAGE_TAG_MARKER="v1.0.0"
TLS_SECRET_NAME="20261122bielcrystal.com"

usage() {
  cat <<'EOF'
Masterion ACK deployment tool

Usage:
  ./deploy.sh --env <test|production> <command> [arguments]

Required for all cluster commands:
  KUBECONFIG       Explicit kubeconfig file outside the repository.
  ACK_CONTEXT      Kubeconfig context. Test defaults to ack-c23ea84b-masterlion-test.

Required for mutating commands:
  ACK_API_SERVER             Exact API server URL printed by the preflight command.
  MASTERLION_IMAGE_DIGEST    Immutable sha256: digest for Masterion v1.0.0.
  BRIDGE_IMAGE_DIGEST        Immutable sha256: digest for Aihub DB Bridge v1.0.0.

Commands:
  preflight                  Read-only ACK capability and identity checks.
  render                     Render manifests with immutable image digests.
  validate                   Client-side validation of rendered manifests.
  bootstrap                  Create the namespace and test StorageClass.
  create-secret [app-env] [bridge-env]
                              Create/update isolated app and bridge Secrets.
  deploy                     Server dry-run and apply the selected overlay.
  start                      Scale Masterion to one replica after data restore.
  stop                       Scale Masterion to zero replicas.
  status                     Show workloads, ingress and persistent volumes.
  rollout                    Wait for all running workloads.
  logs [service]             Follow logs (masterlion|postgres|redis|aihub-db-bridge).
  restart [service]          Restart a workload.
  port-forward [port]        Forward a local port to Masterion.
  update-image <service> <image@sha256:digest>
  info                       Show guarded cluster identity and namespace details.

The script deliberately has no namespace-delete command.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "${1:-}" == "--env" ]] || { usage; fail "--env test or --env production is required"; }
ENVIRONMENT="${2:-}"
shift 2
COMMAND="${1:-}"
shift || true

case "$ENVIRONMENT" in
  test)
    NAMESPACE="masterlion-test"
    EXPECTED_ACK_CLUSTER_ID="$TEST_ACK_CLUSTER_ID"
    OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test"
    MIGRATION_OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/test-migration"
    EXPECTED_CONTEXT="${ACK_CONTEXT:-$DEFAULT_TEST_CONTEXT}"
    ;;
  production)
    NAMESPACE="masterlion"
    EXPECTED_ACK_CLUSTER_ID="$PRODUCTION_ACK_CLUSTER_ID"
    OVERLAY_DIR="$SCRIPT_DIR/k8s/overlays/production"
    EXPECTED_CONTEXT="${ACK_CONTEXT:-}"
    [[ -n "$EXPECTED_CONTEXT" ]] || fail "ACK_CONTEXT is required for production"
    ;;
  *) usage; fail "unknown environment: $ENVIRONMENT" ;;
esac

KUBE=()

init_kube() {
  command -v kubectl >/dev/null 2>&1 || fail "kubectl is not installed"
  [[ -n "${KUBECONFIG:-}" ]] || fail "KUBECONFIG must point to the ACK kubeconfig"
  [[ -f "$KUBECONFIG" ]] || fail "KUBECONFIG file does not exist: $KUBECONFIG"
  KUBE=(kubectl --kubeconfig "$KUBECONFIG" --context "$EXPECTED_CONTEXT")
}

verify_target() {
  local mutation="${1:-read}"
  local current_context api_server namespace_cluster regions

  init_kube
  current_context="$(kubectl --kubeconfig "$KUBECONFIG" config current-context)"
  [[ "$current_context" == "$EXPECTED_CONTEXT" ]] || fail \
    "current context '$current_context' is not the guarded context '$EXPECTED_CONTEXT'"

  api_server="$(kubectl --kubeconfig "$KUBECONFIG" config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
  [[ -n "$api_server" ]] || fail "could not read the ACK API server from kubeconfig"

  if [[ "$mutation" == "mutation" ]]; then
    [[ -n "${ACK_API_SERVER:-}" ]] || fail \
      "ACK_API_SERVER is required for mutations; preflight reports the expected value"
    [[ "$api_server" == "$ACK_API_SERVER" ]] || fail \
      "API server mismatch: kubeconfig does not match ACK_API_SERVER"
  elif [[ -n "${ACK_API_SERVER:-}" && "$api_server" != "$ACK_API_SERVER" ]]; then
    fail "API server mismatch: kubeconfig does not match ACK_API_SERVER"
  fi

  regions="$("${KUBE[@]}" get nodes -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/region}{"\n"}{end}' | sed '/^$/d' | sort -u)"
  [[ "$regions" == "$EXPECTED_ACK_REGION" ]] || fail \
    "node region mismatch: expected '$EXPECTED_ACK_REGION', found '${regions:-none}'"

  if "${KUBE[@]}" get namespace "$NAMESPACE" >/dev/null 2>&1; then
    namespace_cluster="$("${KUBE[@]}" get namespace "$NAMESPACE" -o jsonpath='{.metadata.annotations.masterlion\.io/ack-cluster-id}')"
    [[ "$namespace_cluster" == "$EXPECTED_ACK_CLUSTER_ID" ]] || fail \
      "namespace '$NAMESPACE' is not labelled for ACK cluster '$EXPECTED_ACK_CLUSTER_ID'"
  fi
}

require_digest() {
  local name="$1" value="$2"
  [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$name must be an immutable sha256: digest"
}

render_manifests() {
  local render_dir="${1:-$OVERLAY_DIR}"
  require_digest MASTERLION_IMAGE_DIGEST "${MASTERLION_IMAGE_DIGEST:-}"
  require_digest BRIDGE_IMAGE_DIGEST "${BRIDGE_IMAGE_DIGEST:-}"

  kubectl kustomize "$render_dir" | sed \
    -e "s|${MASTERLION_IMAGE}:${IMAGE_TAG_MARKER}|${MASTERLION_IMAGE}@${MASTERLION_IMAGE_DIGEST}|g" \
    -e "s|${BRIDGE_IMAGE}:${IMAGE_TAG_MARKER}|${BRIDGE_IMAGE}@${BRIDGE_IMAGE_DIGEST}|g"
}

required_secret_keys=(
  KEY_VAULTS_SECRET AUTH_SECRET JWKS_KEY POSTGRES_PASSWORD DATABASE_URL
  REDIS_PASSWORD REDIS_URL S3_ACCESS_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
  AIHUB_BRIDGE_TOKEN
)

if [[ "$ENVIRONMENT" == "test" ]]; then
  required_secret_keys+=(AUTH_SSO_PROVIDERS)
fi

if [[ "$ENVIRONMENT" == "production" ]]; then
  required_secret_keys+=(ONLYBOXES_JIT_SIGNING_KEY)
fi

required_bridge_secret_keys=(AIHUB_BRIDGE_TOKEN AIHUB_READONLY_DATABASE_URL)

check_secret() {
  local key value
  "${KUBE[@]}" get secret masterlion-secret -n "$NAMESPACE" >/dev/null 2>&1 || fail \
    "masterlion-secret is missing in namespace '$NAMESPACE'"
  for key in "${required_secret_keys[@]}"; do
    value="$("${KUBE[@]}" get secret masterlion-secret -n "$NAMESPACE" -o "jsonpath={.data.${key}}")"
    [[ -n "$value" ]] || fail "masterlion-secret is missing key: $key"
  done
  "${KUBE[@]}" get secret masterlion-bridge-secret -n "$NAMESPACE" >/dev/null 2>&1 || fail \
    "masterlion-bridge-secret is missing in namespace '$NAMESPACE'"
  for key in "${required_bridge_secret_keys[@]}"; do
    value="$("${KUBE[@]}" get secret masterlion-bridge-secret -n "$NAMESPACE" -o "jsonpath={.data.${key}}")"
    [[ -n "$value" ]] || fail "masterlion-bridge-secret is missing key: $key"
  done
  app_token="$("${KUBE[@]}" get secret masterlion-secret -n "$NAMESPACE" -o jsonpath='{.data.AIHUB_BRIDGE_TOKEN}')"
  bridge_token="$("${KUBE[@]}" get secret masterlion-bridge-secret -n "$NAMESPACE" -o jsonpath='{.data.AIHUB_BRIDGE_TOKEN}')"
  [[ "$app_token" == "$bridge_token" ]] || fail \
    "AIHUB_BRIDGE_TOKEN differs between application and bridge Secrets"
}

service_resource() {
  case "$1" in
    masterlion) echo "deployment/masterlion" ;;
    aihub-db-bridge) echo "deployment/masterlion-aihub-db-bridge" ;;
    postgres) echo "statefulset/masterlion-postgres" ;;
    redis) echo "statefulset/masterlion-redis" ;;
    *) fail "unknown service: $1" ;;
  esac
}

case "$COMMAND" in
  preflight)
    verify_target read
    api_server="$(kubectl --kubeconfig "$KUBECONFIG" config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}')"
    echo "ACK cluster ID: $EXPECTED_ACK_CLUSTER_ID"
    echo "Context: $EXPECTED_CONTEXT"
    echo "API server: $api_server"
    echo "Set before mutations: export ACK_API_SERVER='$api_server'"
    echo
    "${KUBE[@]}" get nodes -o wide
    echo
    "${KUBE[@]}" get storageclass
    echo
    "${KUBE[@]}" get csidriver diskplugin.csi.alibabacloud.com
    echo
    "${KUBE[@]}" get ingressclass nginx
    echo
    "${KUBE[@]}" get pods -n kube-system -o name | grep -E 'ingress|csi|acr-credential' || true
    if "${KUBE[@]}" get namespace "$NAMESPACE" >/dev/null 2>&1; then
      "${KUBE[@]}" get serviceaccount default -n "$NAMESPACE" -o jsonpath='Default service account pull secrets: {.imagePullSecrets}{"\n"}'
      "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" || true
    else
      echo "Namespace '$NAMESPACE' does not exist yet; run bootstrap after reviewing preflight."
    fi
    ;;
  render)
    render_manifests
    ;;
  validate)
    rendered="$(render_manifests)"
    printf '%s\n' "$rendered" | grep -q "image: ${MASTERLION_IMAGE}@${MASTERLION_IMAGE_DIGEST}"
    printf '%s\n' "$rendered" | grep -q "image: ${BRIDGE_IMAGE}@${BRIDGE_IMAGE_DIGEST}"
    if printf '%s\n' "$rendered" | grep -qi 'searxng'; then
      fail "rendered manifests unexpectedly contain SearXNG"
    fi
    if [[ "$ENVIRONMENT" == "test" ]]; then
      printf '%s\n' "$rendered" | grep -q 'name: masterlion-test-essd-retain'
      printf '%s\n' "$rendered" | grep -q 'host: mlai-test.bielcrystal.com'
      printf '%s\n' "$rendered" | grep -q 'replicas: 1'
      if printf '%s\n' "$rendered" | grep -q 'host: masterlion.bielcrystal.com'; then
        fail "test manifests contain the production hostname"
      fi
      migration_rendered="$(render_manifests "$MIGRATION_OVERLAY_DIR")"
      printf '%s\n' "$migration_rendered" | grep -q 'replicas: 0'
      if printf '%s\n' "$migration_rendered" | grep -q 'host: masterlion.bielcrystal.com'; then
        fail "test migration manifests contain the production hostname"
      fi
    fi
    echo "Kustomize rendering and environment invariants passed."
    ;;
  bootstrap)
    [[ "$ENVIRONMENT" == "test" ]] || fail "bootstrap is only used for the test environment"
    verify_target mutation
    "${KUBE[@]}" apply -f "$OVERLAY_DIR/namespace.yaml"
    "${KUBE[@]}" apply -f "$OVERLAY_DIR/storageclass.yaml"
    verify_target mutation
    ;;
  create-secret)
    verify_target mutation
    secret_file="${1:-$OVERLAY_DIR/secret.env}"
    bridge_secret_file="${2:-$OVERLAY_DIR/bridge-secret.env}"
    [[ -f "$secret_file" ]] || fail "secret env file does not exist: $secret_file"
    [[ -f "$bridge_secret_file" ]] || fail "bridge secret env file does not exist: $bridge_secret_file"
    if grep -q 'CHANGE_ME' "$secret_file" || grep -q 'CHANGE_ME' "$bridge_secret_file"; then
      fail "a secret env file still contains CHANGE_ME placeholders"
    fi
    for key in "${required_secret_keys[@]}"; do
      grep -Eq "^${key}=.+" "$secret_file" || fail "secret env file is missing key: $key"
    done
    for key in "${required_bridge_secret_keys[@]}"; do
      grep -Eq "^${key}=.+" "$bridge_secret_file" || fail "bridge secret env file is missing key: $key"
    done
    s3_key="$(sed -n 's/^S3_ACCESS_KEY=//p' "$secret_file")"
    s3_key_id="$(sed -n 's/^S3_ACCESS_KEY_ID=//p' "$secret_file")"
    [[ "$s3_key" == "$s3_key_id" ]] || fail "S3_ACCESS_KEY and S3_ACCESS_KEY_ID must match"
    app_bridge_token="$(sed -n 's/^AIHUB_BRIDGE_TOKEN=//p' "$secret_file")"
    bridge_token="$(sed -n 's/^AIHUB_BRIDGE_TOKEN=//p' "$bridge_secret_file")"
    [[ "$app_bridge_token" == "$bridge_token" ]] || fail \
      "AIHUB_BRIDGE_TOKEN must match in the application and bridge env files"
    "${KUBE[@]}" create secret generic masterlion-secret -n "$NAMESPACE" \
      --from-env-file="$secret_file" --dry-run=client -o yaml | "${KUBE[@]}" apply -f -
    "${KUBE[@]}" create secret generic masterlion-bridge-secret -n "$NAMESPACE" \
      --from-env-file="$bridge_secret_file" --dry-run=client -o yaml | "${KUBE[@]}" apply -f -
    check_secret
    ;;
  deploy)
    verify_target mutation
    check_secret
    "${KUBE[@]}" get secret "$TLS_SECRET_NAME" -n "$NAMESPACE" >/dev/null 2>&1 || fail \
      "TLS secret '$TLS_SECRET_NAME' is missing in namespace '$NAMESPACE'"
    deploy_overlay="$OVERLAY_DIR"
    if [[ "$ENVIRONMENT" == "test" ]]; then
      cutover_complete="$("${KUBE[@]}" get namespace "$NAMESPACE" -o jsonpath='{.metadata.annotations.masterlion\.io/cutover-complete}')"
      if [[ "$cutover_complete" != "true" ]]; then
        deploy_overlay="$MIGRATION_OVERLAY_DIR"
        echo "Migration mode: Masterion will remain at zero replicas."
      fi
    fi
    render_manifests "$deploy_overlay" | "${KUBE[@]}" apply --server-side --dry-run=server -f - >/dev/null
    render_manifests "$deploy_overlay" | "${KUBE[@]}" apply --server-side -f -
    ;;
  start)
    verify_target mutation
    check_secret
    if [[ "$ENVIRONMENT" == "test" ]]; then
      database_confirmation="${CONFIRM_DATABASE_READY:-${CONFIRM_DATA_RESTORED:-}}"
      [[ "$database_confirmation" == "$NAMESPACE" ]] || fail \
        "set CONFIRM_DATABASE_READY=$NAMESPACE after the fresh database is ready or a restore is validated"
    fi
    "${KUBE[@]}" scale deployment/masterlion -n "$NAMESPACE" --replicas=1
    "${KUBE[@]}" rollout status deployment/masterlion -n "$NAMESPACE" --timeout=10m
    if [[ "$ENVIRONMENT" == "test" ]]; then
      "${KUBE[@]}" annotate namespace "$NAMESPACE" masterlion.io/cutover-complete=true --overwrite
    fi
    ;;
  stop)
    verify_target mutation
    if [[ "$ENVIRONMENT" == "test" ]]; then
      "${KUBE[@]}" annotate namespace "$NAMESPACE" masterlion.io/cutover-complete=false --overwrite
    fi
    "${KUBE[@]}" scale deployment/masterlion -n "$NAMESPACE" --replicas=0
    ;;
  status)
    verify_target read
    "${KUBE[@]}" get pods,services,ingress,statefulsets,deployments,pvc -n "$NAMESPACE" -o wide
    ;;
  rollout)
    verify_target read
    "${KUBE[@]}" rollout status statefulset/masterlion-postgres -n "$NAMESPACE" --timeout=10m
    "${KUBE[@]}" rollout status statefulset/masterlion-redis -n "$NAMESPACE" --timeout=10m
    "${KUBE[@]}" rollout status deployment/masterlion-aihub-db-bridge -n "$NAMESPACE" --timeout=10m
    replicas="$("${KUBE[@]}" get deployment masterlion -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
    if [[ "$replicas" != "0" ]]; then
      "${KUBE[@]}" rollout status deployment/masterlion -n "$NAMESPACE" --timeout=10m
    fi
    ;;
  logs)
    verify_target read
    service="${1:-masterlion}"
    case "$service" in
      masterlion|aihub-db-bridge)
        "${KUBE[@]}" logs -n "$NAMESPACE" -l "app.kubernetes.io/name=$service" --tail=100 -f
        ;;
      postgres)
        "${KUBE[@]}" logs -n "$NAMESPACE" masterlion-postgres-0 --tail=100 -f
        ;;
      redis)
        "${KUBE[@]}" logs -n "$NAMESPACE" masterlion-redis-0 --tail=100 -f
        ;;
      *) fail "unknown service: $service" ;;
    esac
    ;;
  restart)
    verify_target mutation
    service="${1:-masterlion}"
    resource="$(service_resource "$service")"
    "${KUBE[@]}" rollout restart -n "$NAMESPACE" "$resource"
    "${KUBE[@]}" rollout status -n "$NAMESPACE" "$resource" --timeout=10m
    ;;
  port-forward)
    verify_target read
    port="${1:-3210}"
    "${KUBE[@]}" port-forward -n "$NAMESPACE" service/masterlion "${port}:3210"
    ;;
  update-image)
    verify_target mutation
    service="${1:-}"
    image="${2:-}"
    [[ "$service" == "masterlion" || "$service" == "aihub-db-bridge" ]] || fail \
      "update-image supports masterlion or aihub-db-bridge"
    [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || fail "image must be pinned as image@sha256:digest"
    deployment="$service"
    [[ "$service" == "aihub-db-bridge" ]] && deployment="masterlion-aihub-db-bridge"
    "${KUBE[@]}" set image -n "$NAMESPACE" "deployment/$deployment" "$service=$image"
    "${KUBE[@]}" rollout status -n "$NAMESPACE" "deployment/$deployment" --timeout=10m
    ;;
  info)
    verify_target read
    echo "ACK cluster ID: $EXPECTED_ACK_CLUSTER_ID"
    echo "ACK region: $EXPECTED_ACK_REGION"
    echo "Environment: $ENVIRONMENT"
    echo "Namespace: $NAMESPACE"
    "${KUBE[@]}" cluster-info | head -1
    "${KUBE[@]}" get namespace "$NAMESPACE" -o yaml
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *) usage; fail "unknown command: $COMMAND" ;;
esac
