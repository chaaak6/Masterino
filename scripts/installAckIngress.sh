#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLUSTER_ID="c23ea84b986c446d5b3fa9227962e77f4"
CONFIG_FILE="$REPO_ROOT/k8s/overlays/test/ack-nginx-addon.json"
ALIYUN_CLI="${ALIYUN_CLI:-aliyun}"

[[ -f "$CONFIG_FILE" ]] || {
  echo "ERROR: ACK addon configuration is missing: $CONFIG_FILE" >&2
  exit 1
}

"$ALIYUN_CLI" cs InstallClusterAddons \
  --ClusterId "$CLUSTER_ID" \
  --body "$(<"$CONFIG_FILE")"
