# Masterino Kubernetes layouts

The manifests are split into a shared workload base and environment-specific overlays:

- `overlays/production`: `masterlion` namespace and production domain/configuration.
- `overlays/test`: `masterlion-test` namespace for ACK cluster
  `c23ea84b986c446d5b3fa9227962e77f4` in `cn-shenzhen`.
- `overlays/test-migration`: temporary zero-replica application state used while the fresh database
  is initialized or before an optional data restore.

Never run `kubectl apply -f k8s/`. Render or apply an explicit overlay through `deploy.sh`.
The guarded deploy script selects `test-migration` until the first successful `start`, then marks the
namespace cutover complete so later deployments retain the normal one-replica test state.

Application image tags in the base are render-time markers. `deploy.sh` requires immutable
`sha256:` digests and replaces the markers in memory before applying resources.
