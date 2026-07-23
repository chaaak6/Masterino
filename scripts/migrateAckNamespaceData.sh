#!/usr/bin/env bash
set -euo pipefail

SOURCE_NAMESPACE="${SOURCE_NAMESPACE:-masterlion-test}"
TARGET_NAMESPACE="${TARGET_NAMESPACE:-masterino-test}"
SOURCE_POSTGRES_POD="${SOURCE_POSTGRES_POD:-masterlion-postgres-0}"
TARGET_POSTGRES_POD="${TARGET_POSTGRES_POD:-masterino-postgres-0}"
EXPECTED_CONTEXT="${ACK_CONTEXT:-ack-c23ea84b-masterlion-test}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

command -v kubectl >/dev/null 2>&1 || fail "kubectl is not installed"
[[ -n "${KUBECONFIG:-}" && -f "$KUBECONFIG" ]] || fail \
  "KUBECONFIG must point to the ACK kubeconfig"
[[ "${CONFIRM_SOURCE_QUIESCED:-}" == "$SOURCE_NAMESPACE" ]] || fail \
  "set CONFIRM_SOURCE_QUIESCED=$SOURCE_NAMESPACE after scaling the old app to zero"
[[ "${CONFIRM_RESTORE_TARGET:-}" == "$TARGET_NAMESPACE" ]] || fail \
  "set CONFIRM_RESTORE_TARGET=$TARGET_NAMESPACE to replace the target database"

KUBE=(kubectl --kubeconfig "$KUBECONFIG" --context "$EXPECTED_CONTEXT")
current_context="$(kubectl --kubeconfig "$KUBECONFIG" config current-context)"
[[ "$current_context" == "$EXPECTED_CONTEXT" ]] || fail \
  "current context '$current_context' does not match '$EXPECTED_CONTEXT'"

source_replicas="$("${KUBE[@]}" get deployment masterlion -n "$SOURCE_NAMESPACE" -o jsonpath='{.spec.replicas}')"
target_replicas="$("${KUBE[@]}" get deployment masterino -n "$TARGET_NAMESPACE" -o jsonpath='{.spec.replicas}')"
[[ "$source_replicas" == "0" ]] || fail "source deployment must be scaled to zero"
[[ "$target_replicas" == "0" ]] || fail "target deployment must be scaled to zero"

"${KUBE[@]}" wait -n "$SOURCE_NAMESPACE" --for=condition=Ready \
  "pod/$SOURCE_POSTGRES_POD" --timeout=5m
"${KUBE[@]}" wait -n "$TARGET_NAMESPACE" --for=condition=Ready \
  "pod/$TARGET_POSTGRES_POD" --timeout=5m

echo "Streaming a consistent PostgreSQL archive from $SOURCE_NAMESPACE to $TARGET_NAMESPACE..."
"${KUBE[@]}" exec -n "$SOURCE_NAMESPACE" "$SOURCE_POSTGRES_POD" -- sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U postgres -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' |
  "${KUBE[@]}" exec -i -n "$TARGET_NAMESPACE" "$TARGET_POSTGRES_POD" -- sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U postgres -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl'

source_table_count="$("${KUBE[@]}" exec -n "$SOURCE_NAMESPACE" "$SOURCE_POSTGRES_POD" -- sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d "$POSTGRES_DB" -Atc "select count(*) from pg_tables where schemaname = '\''public'\''"')"
target_table_count="$("${KUBE[@]}" exec -n "$TARGET_NAMESPACE" "$TARGET_POSTGRES_POD" -- sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d "$POSTGRES_DB" -Atc "select count(*) from pg_tables where schemaname = '\''public'\''"')"
[[ "$source_table_count" == "$target_table_count" ]] || fail \
  "table-count mismatch: source=$source_table_count target=$target_table_count"

echo "PostgreSQL restore verified: $target_table_count public tables."
echo "Redis is intentionally not copied; it is treated as disposable cache/session state."
