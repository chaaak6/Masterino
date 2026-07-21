#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../deploy" && pwd)"

IMAGE_NAME="${IMAGE_NAME:-masterlion:local}"
BRIDGE_IMAGE="${BRIDGE_IMAGE:-masterlion-aihub-db-bridge:local}"
NETWORK="${NETWORK:-masterlion_masterlion-net}"

export DOCKER_BUILDKIT=1

echo "==> [1/3] Building Masterion image: $IMAGE_NAME"
docker build \
  -t "$IMAGE_NAME" \
  -f "$PROJECT_ROOT/Dockerfile" \
  --build-arg USE_CN_MIRROR=true \
  --progress=plain \
  "$PROJECT_ROOT"

echo "==> [2/3] Building Aihub DB Bridge image: $BRIDGE_IMAGE"
docker build \
  -t "$BRIDGE_IMAGE" \
  -f "$PROJECT_ROOT/Dockerfile.aihub-db-bridge" \
  --build-arg USE_CN_MIRROR=true \
  "$PROJECT_ROOT"

echo "==> [3/3] Restarting Masterion container..."
docker stop masterlion 2>/dev/null && docker rm masterlion 2>/dev/null || true

docker run -d \
  --name masterlion \
  --network "$NETWORK" \
  -p 3210:3210 \
  --restart always \
  --env-file "$DEPLOY_DIR/.env" \
  "$IMAGE_NAME"

echo "==> Done."
sleep 5
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep -E "NAME|masterlion"
