# ACK test deployment through Alibaba Cloud CI

Use an Alibaba Cloud DevOps Flow runner inside the Shenzhen VPC. The pipeline obtains a temporary
ACK kubeconfig through Alibaba Cloud CLI and delegates all Kubernetes validation and mutation to
the guarded repository `deploy.sh`. It never deploys production or performs the public Ingress
cutover.

## Runner tools and identity

Install `aliyun`, `jq`, `kubectl`, `bash`, and GNU `base64` on the runner. Install Docker/Buildx
only when the same pipeline also builds images. Configure Alibaba Cloud CLI through a RAM role or a
dedicated RAM user. The identity needs:

- permission to call `cs:DescribeClusterUserKubeconfig` for ACK cluster
  `c23ea84b986c446d5b3fa9227962e77f4`;
- Kubernetes RBAC permissions for the guarded `masterino-test` namespace and the cluster-scoped
  StorageClass used by `deploy.sh`;
- ACR pull/push permission only for the two `biel_client/masterino*` repositories when the same
  pipeline also builds images.

Prefer a temporary internal-network kubeconfig. The CI helper defaults to a 120-minute credential
and deletes the kubeconfig and temporary env files when the step exits.

## Private variable group

Create a test-only private variable group in the Flow UI. Do not put these values in pipeline YAML
or repository files.

Generate once and retain across deployments:

- `KEY_VAULTS_SECRET`: base64 encoding of 32 random bytes.
- `AUTH_SECRET`: 64 hexadecimal characters.
- `JWKS_KEY`: an RSA private JWKS JSON string.
- `POSTGRES_PASSWORD`: URL-safe random password.
- `REDIS_PASSWORD`: URL-safe random password.
- `AIHUB_BRIDGE_TOKEN`: random internal service token.

Platform-issued values:

- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`: dedicated test OSS RAM credential.
- `AIHUB_READONLY_DATABASE_URL`: read-only Aihub database account, available only to the bridge.
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and `QSTASH_NEXT_SIGNING_KEY`: dedicated test
  Upstash QStash credentials.

Non-secret deployment inputs:

- `MASTERLION_IMAGE_DIGEST`: digest of the application image built from the reviewed commit.
- `BRIDGE_IMAGE_DIGEST`: digest of the reviewed bridge image. The memory branch does not change
  `apps/aihub-db-bridge`, so the currently approved bridge digest may be reused.

The Aihub `masterlion-managed` token is not a CI variable. The target Aihub user group and each
test user's managed token must both authorize `glm-5.2` and `text-embedding-3-large`.

## Flow command steps

Read-only identity and cluster capability check:

```bash
ACK_TEST_ACTION=preflight bash scripts/ci/deployAckTest.sh
```

Render and validate manifests with immutable image digests:

```bash
ACK_TEST_ACTION=validate bash scripts/ci/deployAckTest.sh
```

Deploy the private test staging state:

```bash
export ACK_TEST_ACTION=deploy
export CONFIRM_ACK_TEST_DEPLOY=masterino-test
bash scripts/ci/deployAckTest.sh
```

The deploy action creates or updates Kubernetes Secrets, applies the migration overlay, and waits
for PostgreSQL, Redis, and Aihub DB Bridge. Masterino remains at zero replicas with no public
Ingress until database readiness is separately confirmed. Starting Masterino, private acceptance,
cutover, and the QStash hourly schedule remain explicit follow-up operations.

Alibaba Cloud DevOps private variables should be configured in the UI or an attached private
variable group. Do not echo the variable group or enable shell tracing in the command step.
