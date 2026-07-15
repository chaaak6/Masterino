#!/usr/bin/env bash
set -euo pipefail

# Data-plane helper for migrating the Docker test database to ACK.
# Run source commands on the old test server and target commands from a host with ACK access.

EXPECTED_CONTEXT="${ACK_CONTEXT:-ack-c23ea84b-masterlion-test}"
NAMESPACE="masterlion-test"
SOURCE_POSTGRES_CONTAINER="${SOURCE_POSTGRES_CONTAINER:-masterlion-postgres}"
DATABASE_NAME="${DATABASE_NAME:-lobechat}"
DATABASE_USER="${DATABASE_USER:-postgres}"
ARTIFACT_DIR="${MIGRATION_ARTIFACT_DIR:-migration-artifacts}"
DEFAULT_COS_HOST="mlai-test-1435304320.cos.ap-guangzhou.myqcloud.com"

usage() {
  cat <<'EOF'
Usage: scripts/migrateTestToAck.sh <command> [arguments]

Commands:
  source-inventory              Show source database size, extensions and key table counts.
  source-url-audit              Count absolute attachment URLs by host on the source database.
  backup [dump-file]            Create a custom-format PostgreSQL dump and sha256 file.
  target-inventory              Show target database size, extensions and key table counts.
  target-url-audit              Count absolute attachment URLs by host on the target database.
  restore <dump-file>           Restore a dump while the target MasterLion deployment is stopped.
  rewrite-target-cos-urls       Convert old COS URLs in files/global_files to relative object keys.

Target commands require KUBECONFIG and the guarded ACK context. Restore requires the
target MasterLion deployment to exist with zero replicas.

rewrite-target-cos-urls also requires:
  CONFIRM_REWRITE=masterlion-test
  OLD_COS_HOST=<hostname>        Defaults to the historical test COS hostname.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

source_psql() {
  docker exec "$SOURCE_POSTGRES_CONTAINER" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$1" -d "$2"' \
    sh "$DATABASE_USER" "$DATABASE_NAME"
}

init_target() {
  command -v kubectl >/dev/null 2>&1 || fail "kubectl is not installed"
  [[ -n "${KUBECONFIG:-}" && -f "$KUBECONFIG" ]] || fail "KUBECONFIG is required"
  current_context="$(kubectl --kubeconfig "$KUBECONFIG" config current-context)"
  [[ "$current_context" == "$EXPECTED_CONTEXT" ]] || fail \
    "current context '$current_context' is not '$EXPECTED_CONTEXT'"
  KUBE=(kubectl --kubeconfig "$KUBECONFIG" --context "$EXPECTED_CONTEXT")
  namespace_cluster="$("${KUBE[@]}" get namespace "$NAMESPACE" -o jsonpath='{.metadata.annotations.masterlion\.io/ack-cluster-id}')"
  [[ "$namespace_cluster" == "c23ea84b986c446d5b3fa9227962e77f4" ]] || fail \
    "target namespace is not bound to the expected ACK cluster"
}

target_pod() {
  local pod
  pod="$("${KUBE[@]}" get pod -n "$NAMESPACE" -l app.kubernetes.io/name=postgres \
    -o jsonpath='{.items[0].metadata.name}')"
  [[ -n "$pod" ]] || fail "target PostgreSQL pod was not found"
  echo "$pod"
}

target_psql() {
  local pod
  pod="$(target_pod)"
  "${KUBE[@]}" exec -i -n "$NAMESPACE" "$pod" -- sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$1" -d "$2"' \
    sh "$DATABASE_USER" "$DATABASE_NAME"
}

inventory_sql=$(cat <<'SQL'
SELECT current_database() AS database,
       pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('vector', 'pg_search')
ORDER BY extname;
SELECT table_name, exact_rows
FROM (
  SELECT 'agents' AS table_name, count(*) AS exact_rows FROM agents
  UNION ALL SELECT 'files', count(*) FROM files
  UNION ALL SELECT 'global_files', count(*) FROM global_files
  UNION ALL SELECT 'knowledge_bases', count(*) FROM knowledge_bases
  UNION ALL SELECT 'messages', count(*) FROM messages
  UNION ALL SELECT 'sessions', count(*) FROM sessions
  UNION ALL SELECT 'users', count(*) FROM users
) key_table_counts
ORDER BY table_name;
SQL
)

url_audit_sql=$(cat <<'SQL'
SELECT source_table, host, count(*) AS rows
FROM (
  SELECT 'files' AS source_table,
         substring(url FROM '^https?://([^/]+)') AS host
  FROM files
  WHERE url ~ '^https?://'
  UNION ALL
  SELECT 'global_files' AS source_table,
         substring(url FROM '^https?://([^/]+)') AS host
  FROM global_files
  WHERE url ~ '^https?://'
) absolute_urls
GROUP BY source_table, host
ORDER BY source_table, host;
SQL
)

command="${1:-}"
shift || true

case "$command" in
  source-inventory)
    command -v docker >/dev/null 2>&1 || fail "docker is not installed"
    printf '%s\n' "$inventory_sql" | source_psql
    ;;
  source-url-audit)
    command -v docker >/dev/null 2>&1 || fail "docker is not installed"
    printf '%s\n' "$url_audit_sql" | source_psql
    ;;
  backup)
    command -v docker >/dev/null 2>&1 || fail "docker is not installed"
    command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not installed"
    mkdir -p "$ARTIFACT_DIR"
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    dump_file="${1:-$ARTIFACT_DIR/masterlion-test-$timestamp.dump}"
    [[ ! -e "$dump_file" ]] || fail "refusing to overwrite existing dump: $dump_file"
    echo "Creating PostgreSQL dump: $dump_file"
    docker exec "$SOURCE_POSTGRES_CONTAINER" sh -c \
      'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$1" -d "$2" -Fc --no-owner --no-acl' \
      sh "$DATABASE_USER" "$DATABASE_NAME" >"$dump_file"
    [[ -s "$dump_file" ]] || fail "database dump is empty"
    sha256sum "$dump_file" >"$dump_file.sha256"
    echo "Backup complete. Keep both the dump and checksum outside Git."
    ;;
  target-inventory)
    init_target
    printf '%s\n' "$inventory_sql" | target_psql
    ;;
  target-url-audit)
    init_target
    printf '%s\n' "$url_audit_sql" | target_psql
    ;;
  restore)
    dump_file="${1:-}"
    [[ -n "$dump_file" && -s "$dump_file" ]] || fail "a non-empty dump file is required"
    init_target
    replicas="$("${KUBE[@]}" get deployment masterlion -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
    [[ "$replicas" == "0" ]] || fail "target MasterLion must have zero replicas before restore"
    if [[ -f "$dump_file.sha256" ]]; then
      command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not installed"
      sha256sum -c "$dump_file.sha256"
    else
      echo "WARNING: no checksum file found for $dump_file" >&2
    fi
    pod="$(target_pod)"
    echo "Restoring $dump_file into $NAMESPACE/$pod..."
    "${KUBE[@]}" exec -i -n "$NAMESPACE" "$pod" -- sh -c \
      'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --exit-on-error --no-owner --no-acl -U "$1" -d "$2"' \
      sh "$DATABASE_USER" "$DATABASE_NAME" <"$dump_file"
    echo "Restore complete. Run target-inventory and target-url-audit before starting MasterLion."
    ;;
  rewrite-target-cos-urls)
    [[ "${CONFIRM_REWRITE:-}" == "$NAMESPACE" ]] || fail \
      "set CONFIRM_REWRITE=$NAMESPACE after taking and verifying a database backup"
    old_host="${OLD_COS_HOST:-$DEFAULT_COS_HOST}"
    [[ "$old_host" =~ ^[A-Za-z0-9.-]+$ ]] || fail "OLD_COS_HOST is not a valid hostname"
    init_target
    replicas="$("${KUBE[@]}" get deployment masterlion -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
    [[ "$replicas" == "0" ]] || fail "target MasterLion must have zero replicas before URL rewrite"
    cat <<SQL | target_psql
BEGIN;
SELECT 'files_before' AS metric, count(*) AS value FROM files
WHERE url ~ '^https?://${old_host}/';
SELECT 'global_files_before' AS metric, count(*) AS value FROM global_files
WHERE url ~ '^https?://${old_host}/';
UPDATE files
SET url = regexp_replace(url, '^https?://${old_host}/', '')
WHERE url ~ '^https?://${old_host}/';
UPDATE global_files
SET url = regexp_replace(url, '^https?://${old_host}/', '')
WHERE url ~ '^https?://${old_host}/';
COMMIT;
SQL
    echo "URL rewrite complete. Run target-url-audit and verify historical attachments."
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *) usage; fail "unknown command: $command" ;;
esac
