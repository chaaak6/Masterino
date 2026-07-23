# Masterino Kubernetes layouts

The manifests are split into a shared workload base and environment-specific overlays:

- `overlays/production`: `masterino` namespace and production domain/configuration.
- `overlays/test`: `masterino-test` namespace for ACK cluster
  `c23ea84b986c446d5b3fa9227962e77f4` in `cn-shenzhen`; it deliberately has no
  public Ingress so it can be validated beside the old namespace.
- `overlays/test-cutover`: adds the `mlai-test.bielcrystal.com` Ingress only
  during the guarded cutover.
- `overlays/test-migration`: temporary zero-replica application state used while the fresh database
  is initialized or before an optional data restore.

Never run `kubectl apply -f k8s/`. Render or apply an explicit overlay through `deploy.sh`.
The guarded deploy script selects `test-migration` until the database is restored. `start` brings the
application up without taking public traffic. `cutover` is a separate, explicit action that installs
the public Ingress after the old Ingress has been removed.

Application image tags in the base are render-time markers. `deploy.sh` requires immutable
`sha256:` digests and replaces the markers in memory before applying resources.
