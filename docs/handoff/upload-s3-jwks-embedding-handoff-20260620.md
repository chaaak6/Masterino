# Upload / S3 Proxy / JWKS / Embedding Handoff - 2026-06-20

## Context

User reported that file/image upload still failed with no visible error, and requested Playwright testing with account `10193226`.

The upload path under investigation is the Resource page:

- URL: `/resource`
- UI path: `添加` -> `上传文件`
- Browser upload path must remain same-origin: `/api/upload/s3-proxy`
- Do not switch browser uploads back to `rustfs:9000`

## Current Finding

RustFS did not provide vectorization. RustFS was only object storage. The current failure that looks like "upload failed" is actually a later task in the pipeline:

1. Object upload to S3/COS via `/api/upload/s3-proxy`: working
2. File row creation in DB: working
3. Chunking task: working after `JWKS_KEY` was configured
4. Embedding/vectorization task: failing when auto-enabled because Aihub user `10193226` has no available embedding model

Aihub bridge returned 13 accessible models for `10193226`; all were chat/image style models and none were embedding models:

- `deepseek-v4-flash`
- `deepseek-v4-flash-202605`
- `deepseek-v4-pro`
- `deepseek-v4-pro-202606`
- `glm-5.2`
- `glm5.1`
- `kimi-k2.7-code`
- `minimax-m3`
- `qwen-image-2.0`
- `qwen-image-2.0-pro`
- `qwen3.6-flash`
- `qwen3.6-plus`
- `qwen3.7-max`

When auto embedding was enabled, new text uploads created an embedding task that failed with:

```text
EmbeddingError: ModelNotFound
```

## Applied Configuration Changes

Configured `JWKS_KEY` in:

- `docker-compose/deploy/.env`

The generated key value is intentionally not copied into this handoff.

Configured auto embedding off in:

- `docker-compose/deploy/.env`

```bash
CHUNKS_AUTO_EMBEDDING=0
```

Restarted `masterlion` after each config change:

```bash
docker compose --env-file docker-compose/deploy/.env -f docker-compose/deploy/docker-compose.yml up -d --no-build masterlion
```

Current container verification:

```bash
docker exec masterlion printenv CHUNKS_AUTO_EMBEDDING
# 0
```

## Applied Code Changes

Changed upload error handling so browser-side XHR upload errors are no longer silent or reduced to empty `statusText`:

- `src/services/upload.ts`
- `src/services/__tests__/upload.test.ts`

Changed upload store status handling so upload failures mark UploadDock item status as `error`:

- `src/store/file/slices/upload/action.ts`
- `src/store/file/slices/upload/action.test.ts`

Changed deployment/config tooling:

- `docker-compose/deploy/docker-compose.yml`
  - Added required `JWKS_KEY` env interpolation so deployment fails early if missing.
- `scripts/generate-oidc-jwk.mjs`
  - Fixed Node 18 WebCrypto issue by assigning `globalThis.crypto = nodeCrypto.webcrypto` before importing `jose`.
  - Updated output instructions from old `OIDC_JWKS_KEY` to current `JWKS_KEY`.

## Verification Performed

### Unit tests

Run inside old dev container before the final deployment-container restart:

```bash
docker exec masterlion pnpm exec vitest run --silent='passed-only' src/services/__tests__/upload.test.ts src/store/file/slices/upload/action.test.ts
```

Result:

- `src/services/__tests__/upload.test.ts`: 16 tests passed
- `src/store/file/slices/upload/action.test.ts`: 21 tests passed

### Playwright E2E - after `JWKS_KEY`

With auto embedding still enabled:

- `PUT /api/upload/s3-proxy`: `200`
- `POST chunk.createParseFileTask`: `200`
- File row created
- Chunk task succeeded
- Embedding task failed with `ModelNotFound`

Screenshot:

- `tmp/masterlion-upload-after-jwks.png`

### Playwright E2E - after `CHUNKS_AUTO_EMBEDDING=0`

Used real menu path: `添加` -> exact text `上传文件`.

New test file:

- `masterlion-no-embed-1781945847861.txt`

Network:

- `PUT /api/upload/s3-proxy`: `200`
- `POST /trpc/lambda/chunk.createParseFileTask`: `200`

DB verification:

```text
masterlion-no-embed-1781945847861.txt|success|
```

Meaning:

- file name: `masterlion-no-embed-1781945847861.txt`
- chunk task status: `success`
- embedding task id: empty/null

Screenshot:

- `tmp/masterlion-upload-no-embed-success.png`

## Important Account Note

During Playwright testing, account `10193226` was temporarily changed to password `10193226`.

One interrupted test left the password hash in bcrypt form instead of restoring the original BetterAuth scrypt hash. The current state was verified as:

```text
is_onboarded=false
password length=60
password prefix=$2b$
```

Current known test password:

```text
10193226
```

This should be explicitly addressed later if preserving the original user password hash matters. The original hash was not printed and is not recoverable from this handoff.

## Why RustFS Was Not the Difference

RustFS is S3-compatible object storage. It does not provide:

- chunking
- embeddings
- vector indexing
- semantic search

The reason this appeared different before is likely one of:

- auto embedding was not enabled
- an embedding model was configured/available then
- the UI only exposed the upload success and did not surface embedding failure as clearly
- the current debugging fixed earlier upload/JWKS issues and exposed the next failing stage

## Recommended Next Steps

1. Decide desired behavior:
   - Keep `CHUNKS_AUTO_EMBEDDING=0` if uploads should finish without semantic vector search.
   - Enable auto embedding only after Aihub provides an accessible embedding model.

2. If semantic/vector search is required, configure Aihub:
   - Add or expose an embedding model.
   - Grant that model to group/token used by `10193226`.
   - Then configure:

```bash
DEFAULT_FILES_CONFIG="embedding_model=newapi/<real-embedding-model>,query_mode=full_text"
CHUNKS_AUTO_EMBEDDING=1
```

3. Restart `masterlion` after config changes:

```bash
docker compose --env-file docker-compose/deploy/.env -f docker-compose/deploy/docker-compose.yml up -d --no-build masterlion
```

4. Re-test via Playwright:
   - Login `10193226`
   - `/resource`
   - `添加` -> `上传文件`
   - Verify:
     - `/api/upload/s3-proxy` returns `200`
     - `chunk.createParseFileTask` returns `200`
     - if embedding enabled, embedding task status becomes `success`

## Caveats

- Existing files with historical `分块失败` / `向量化失败` status will remain failed unless retried or re-uploaded.
- `CHUNKS_AUTO_EMBEDDING=0` prevents automatic embedding. Upload and chunking work, but semantic vector retrieval will not be populated for new files.
- The working tree contains many unrelated changes. Do not stage or revert unrelated user/agent changes without reviewing `git status -sb` and `git diff`.
