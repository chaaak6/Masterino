#!/usr/bin/env bash
set -euo pipefail

# MasterLion 生产环境部署运维脚本
# 集群: biel-sap-external (cn-shenzhen)
# 命名空间: masterlion
# 域名: masterlion.bielcrystal.com

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/k8s"
NAMESPACE="masterlion"

usage() {
  cat <<EOF
MasterLion 生产环境运维工具

用法: $0 <命令>

命令:
  deploy       部署/更新所有 K8s 资源
  status       查看所有 Pod/Service/Ingress 状态
  logs [服务]  查看日志 (masterlion|postgres|redis|searxng|aihub-db-bridge)
  restart [服务]  重启指定服务
  rollout      查看滚动更新状态
  scale [服务] [副本数]  调整副本数
  exec [服务]  进入容器终端
  port-forward [端口]  本地端口转发到 masterlion 服务
  update-image [服务] [镜像地址]  更新镜像
  delete       删除整个 masterlion 命名空间 (危险!)
  info         显示集群和部署信息
EOF
}

case "${1:-}" in
  deploy)
    kubectl apply -f "$K8S_DIR/"
    ;;
  status)
    kubectl get pods -n "$NAMESPACE" -o wide
    echo "---"
    kubectl get svc -n "$NAMESPACE"
    echo "---"
    kubectl get ingress -n "$NAMESPACE"
    echo "---"
    kubectl get pvc -n "$NAMESPACE"
    ;;
  logs)
    svc="${2:-masterlion}"
    case "$svc" in
      masterlion)    kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=masterlion --tail=50 -f ;;
      postgres)      kubectl logs -n "$NAMESPACE" masterlion-postgres-0 --tail=50 -f ;;
      redis)         kubectl logs -n "$NAMESPACE" masterlion-redis-0 --tail=50 -f ;;
      searxng)       kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=searxng --tail=50 -f ;;
      aihub-db-bridge) kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=aihub-db-bridge --tail=50 -f ;;
      *) echo "未知服务: $svc"; exit 1 ;;
    esac
    ;;
  restart)
    svc="${2:-masterlion}"
    kubectl rollout restart -n "$NAMESPACE" "$svc"
    echo "重启 $svc 中..."
    kubectl rollout status -n "$NAMESPACE" "$svc"
    ;;
  rollout)
    kubectl rollout status -n "$NAMESPACE" deployment/masterlion
    kubectl rollout status -n "$NAMESPACE" deployment/masterlion-aihub-db-bridge
    kubectl rollout status -n "$NAMESPACE" deployment/masterlion-searxng
    ;;
  scale)
    svc="${2:-masterlion}"
    replicas="${3:-1}"
    kubectl scale -n "$NAMESPACE" deployment/"$svc" --replicas="$replicas"
    ;;
  exec)
    svc="${2:-masterlion}"
    pod=$(kubectl get pod -n "$NAMESPACE" -l app.kubernetes.io/name="$svc" -o jsonpath='{.items[0].metadata.name}')
    kubectl exec -it -n "$NAMESPACE" "$pod" -- sh
    ;;
  port-forward)
    port="${2:-3210}"
    kubectl port-forward -n "$NAMESPACE" svc/masterlion "${port}:3210"
    ;;
  update-image)
    svc="${2:?用法: update-image <服务> <镜像地址>}"
    image="${3:?用法: update-image <服务> <镜像地址>}"
    kubectl set image -n "$NAMESPACE" deployment/"$svc" "$svc=$image"
    kubectl rollout status -n "$NAMESPACE" deployment/"$svc"
    ;;
  delete)
    echo "警告: 这将删除整个 $NAMESPACE 命名空间及所有数据!"
    read -p "确认删除? (输入 yes): " confirm
    [ "$confirm" = "yes" ] && kubectl delete namespace "$NAMESPACE" || echo "已取消"
    ;;
  info)
    echo "=== 集群信息 ==="
    kubectl cluster-info | head -1
    echo ""
    echo "=== 节点 ==="
    kubectl get nodes -o wide
    echo ""
    echo "=== masterlion 命名空间 ==="
    kubectl get all -n "$NAMESPACE"
    ;;
  *)
    usage
    ;;
esac
