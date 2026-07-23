# Masterino technical identifier migration

This runbook migrates the technical identifiers that previously used `masterlion`.
It intentionally keeps compatibility identifiers that would require a separate
application or storage migration.

## Target mapping

| Area | Old | New |
| --- | --- | --- |
| GitHub repository | `chaaak6/MasterLion` | `chaaak6/Masterino` |
| ACR application repository | `biel_client/masterlion` | `biel_client/masterino` |
| ACR bridge repository | `biel_client/masterlion-aihub-db-bridge` | `biel_client/masterino-aihub-db-bridge` |
| Test namespace | `masterlion-test` | `masterino-test` |
| Production namespace | `masterlion` | `masterino` |
| Kubernetes workload prefix | `masterlion-*` | `masterino-*` |
| Docker Compose project/service/network | `masterlion*` | `masterino*` |

The existing domains, OSS buckets, `@masterlion/*` packages, `MASTERLION_*`
environment variables, desktop protocol/bundle/storage identifiers,
`masterlion-managed`, and the existing ACK kubeconfig context remain compatibility
identifiers in this migration.

## Test blue-green procedure

1. Build and scan immutable application and bridge images in the new ACR repositories.
2. Bootstrap `masterino-test`, then copy the application, bridge, TLS, and ACR pull
   Secrets from `masterlion-test` without writing their values to disk or logs.
3. Deploy `k8s/overlays/test-migration`. It creates PostgreSQL, Redis, and the bridge,
   while the application remains at zero replicas and no public Ingress exists.
4. Stop the old application briefly and run `scripts/migrateAckNamespaceData.sh`.
   The script refuses to restore unless both application Deployments are at zero.
5. Start `masterino`, validate it through a local port-forward, and verify login,
   Aihub models/quota, chat, upload, and database writes.
6. Run the guarded `cutover` command. It verifies the old Deployment is stopped,
   removes only the old root route, retains the legacy enterprise-WeChat verification
   path in its original namespace, and installs the new root Ingress.
7. Observe health and logs. Keep the old namespace, PVCs, and ACR repositories
   unchanged during the rollback window.

## Rollback

Run the guarded `rollback` command. It removes the new Ingress, starts the old
Deployment, waits for it to become available, restores the old Ingress, and stops
the new Deployment. Database writes made after cutover are not automatically
replayed to the old database, so rollback after accepting new writes requires a
separate reverse data migration decision.

No step in this runbook deletes the old namespace, PVCs, repository, or images.
