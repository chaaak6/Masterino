# Production observability recovery

These manifests document the production observability guards required by Masterino.

- `masterino-application-logs.yaml` collects stdout and stderr for the `masterlion`
  namespace into the `masterino-application` SLS Logstore.
- `loongcollector-operator-dns-patch.yaml` sets `ndots:1`. The cluster search domain has
  a wildcard response, so the default `ndots:5` can resolve Alibaba Cloud intranet
  endpoints below the search domain and prevent the Operator from becoming ready.
- `masterino-langfuse-config-patch.yaml` enables tracing and uses the in-cluster
  Langfuse Service. This avoids the authentication policy on the internal Ingress.
- `clickhouse-compatible-node-patch.json` keeps the retained `cloud_ssd` volume on the
  verified Shenzhen zone C node until the volume is migrated to `cloud_essd` or
  `cloud_auto` in a dedicated node pool.
- `langfuse-oss-internal-config-patch.yaml` routes Langfuse event, media, and batch-export
  object storage through the Shenzhen OSS internal endpoint.
- `clickhouse-backup-oss-internal-patch.json` routes the ClickHouse backup sidecar through
  the same internal endpoint. Its guard operations fail before mutation if the live pod
  template layout no longer matches the verified structure.

Apply the resources through an ACK kubeconfig that has passed the production target
guard:

```powershell
kubectl apply -f k8s/observability/masterino-application-logs.yaml
kubectl patch deployment loongcollector-operator -n kube-system --type strategic --patch-file k8s/observability/loongcollector-operator-dns-patch.yaml
kubectl patch configmap masterino-config -n masterlion --type merge --patch-file k8s/observability/masterino-langfuse-config-patch.yaml
kubectl patch clickhouseinstallation langfuse -n masterino-observability --type json --patch-file k8s/observability/clickhouse-compatible-node-patch.json
```

Apply the internal object-storage endpoint patches only after the target guard, bucket
probe, and backup checks pass:

```powershell
kubectl patch configmap langfuse-config -n masterino-observability --type merge --patch-file k8s/observability/langfuse-oss-internal-config-patch.yaml
kubectl patch clickhouseinstallation langfuse -n masterino-observability --type json --patch-file k8s/observability/clickhouse-backup-oss-internal-patch.json
```

Never delete the ClickHouse PVC or PV during recovery. The current volume uses the
`Retain` reclaim policy; verify a remote backup before any storage-class migration.
