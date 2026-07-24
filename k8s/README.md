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

## Test memory rollout

Personal memory is opt-in at two levels: the test overlay enables the runtime `+memory` flag, and
each user must then enable Memory in personal settings. Production intentionally has no `+memory`
flag and remains disabled until a separate production rollout is approved. Workspace memory stays
hidden.

Before deploying the test rollout:

1. Copy `overlays/test/secret.env.example` to the ignored `secret.env` and set the three dedicated
   QStash values. Never commit populated secrets or reuse production signing keys.
2. Confirm the application database migrations have completed, including
   `0117_use_halfvec_for_user_memory_embeddings`, and the user-memory tables, 2048-dimension
   `halfvec` columns, pgvector, and ParadeDB indexes exist.
3. Confirm both the target Aihub user group and its `masterlion-managed` token allow `glm-5.2` and
   `text-embedding-3-large`. Do not enable the rollout if either model is unavailable. Memory
   runtimes fail closed on an unauthorized provider/model/type or a missing user-managed token;
   they never borrow server or another provider's credentials.
4. Verify a manual historical extraction end to end before creating a schedule.

After manual extraction succeeds, create an hourly Upstash schedule that sends `POST` to:

```text
https://mlai-test.bielcrystal.com/api/workflows/memory-user-memory/call-cron-hourly-analysis
```

Monitor workflow retries, application errors, Aihub requests, and quota usage. Disabling Memory
stops recall and new extraction but does not delete saved data; users can delete individual items
or clear all memory. A future production rollout must use the production domain, independent
QStash credentials, and an explicit production `+memory` flag.

Application image tags in the base are render-time markers. `deploy.sh` requires immutable
`sha256:` digests and replaces the markers in memory before applying resources.
