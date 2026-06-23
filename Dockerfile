# syntax=docker/dockerfile:1.7

## Set global build ENV
ARG NODEJS_VERSION="24"

## Base image for all building stages
FROM node:${NODEJS_VERSION}-slim AS base

ARG USE_CN_MIRROR

ENV CI="true" \
    DEBIAN_FRONTEND="noninteractive"

# 使用 apt-get + --no-install-recommends，减少非必要包，降低基础层体积。
RUN --mount=type=cache,id=masterlion-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,id=masterlion-apt-cache,target=/var/cache/apt,sharing=locked \
    set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        sed -i "s/deb.debian.org/mirrors.ustc.edu.cn/g" "/etc/apt/sources.list.d/debian.sources"; \
    fi && \
    apt-get update && \
    apt-get install --no-install-recommends ca-certificates proxychains-ng -qy && \
    mkdir -p /distroless/bin /distroless/etc /distroless/etc/ssl/certs /distroless/lib && \
    cp /usr/lib/$(arch)-linux-gnu/libproxychains.so.4 /distroless/lib/libproxychains.so.4 && \
    cp /usr/lib/$(arch)-linux-gnu/libdl.so.2 /distroless/lib/libdl.so.2 && \
    cp /usr/bin/proxychains4 /distroless/bin/proxychains && \
    cp /etc/proxychains4.conf /distroless/etc/proxychains4.conf && \
    cp /usr/lib/$(arch)-linux-gnu/libstdc++.so.6 /distroless/lib/libstdc++.so.6 && \
    cp /usr/lib/$(arch)-linux-gnu/libgcc_s.so.1 /distroless/lib/libgcc_s.so.1 && \
    cp /usr/lib/$(arch)-linux-gnu/librt.so.1 /distroless/lib/librt.so.1 && \
    cp /usr/local/bin/node /distroless/bin/node && \
    cp /etc/ssl/certs/ca-certificates.crt /distroless/etc/ssl/certs/ca-certificates.crt && \
    rm -rf /tmp/* /var/tmp/*

## manifest 阶段：只抽取 pnpm 安装依赖所需的 package.json / lockfile / workspace 文件。
## 目的：业务源码变更时，不要让 pnpm install 依赖层失效。
## BuildKit 基于 /manifests/ 内容 hash 缓存，源码变动时输出不变 → 依赖层命中缓存。
FROM base AS workspace-manifests

WORKDIR /workspace

COPY . .

RUN set -e && \
    mkdir -p /manifests && \
    cp --parents package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /manifests/ && \
    if [ -d patches ]; then cp -a patches /manifests/patches; fi && \
    for dir in packages apps; do \
        if [ -d "$dir" ]; then \
            find "$dir" -name package.json -type f -exec cp --parents {} /manifests/ \; ; \
        fi; \
    done

## Builder image, install all the dependencies and build the app
FROM base AS builder

ARG USE_CN_MIRROR

# Node
ENV NODE_OPTIONS="--max-old-space-size=8192"

WORKDIR /app

# 从 workspace-manifests 阶段只复制 manifest 文件，源码变动不影响此层缓存。
COPY --from=workspace-manifests /manifests/ ./

# 1. 直接使用 Node 自带 corepack，按 packageManager 固定 pnpm 版本。
# 2. --frozen-lockfile 保证可复现，--prefer-offline 优先复用缓存。
# 【新增】corepack-cache 挂载：避免每次构建重新下载 pnpm 本体。
RUN --mount=type=cache,id=masterlion-npm-cache,target=/root/.npm,sharing=locked \
    --mount=type=cache,id=masterlion-pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=masterlion-corepack-cache,target=/root/.cache/node/corepack,sharing=locked \
    set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        export SENTRYCLI_CDNURL="https://npmmirror.com/mirrors/sentry-cli"; \
        npm config set registry "https://registry.npmmirror.com/"; \
        echo 'canvas_binary_host_mirror=https://npmmirror.com/mirrors/canvas' >> .npmrc; \
        export FFMPEG_BINARIES_URL="https://npmmirror.com/mirrors/ffmpeg-static"; \
    fi && \
    export COREPACK_NPM_REGISTRY="$(npm config get registry | sed 's/\/$//')" && \
    corepack enable && \
    corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        pnpm config set registry "https://registry.npmmirror.com/"; \
    fi && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --node-linker=hoisted --prefer-offline && \
    mkdir -p /deps && \
    cd /deps && \
    echo '{"name":"deps","private":true}' > package.json && \
    pnpm add pg drizzle-orm --prefer-offline

COPY . .

# ARG/ENV 只影响预构建 / Next.js 构建，放在 COPY . . 之后，避免打掉依赖安装缓存。
ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_ANALYTICS_POSTHOG
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_ANALYTICS_UMAMI
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG FEATURE_FLAGS

ENV NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH}" \
    FEATURE_FLAGS="${FEATURE_FLAGS}"

ENV APP_URL="http://app.com" \
    DATABASE_DRIVER="node" \
    DATABASE_URL="postgres://postgres:password@localhost:5432/postgres" \
    KEY_VAULTS_SECRET="use-for-build" \
    AUTH_SECRET="use-for-build"

# Sentry
ENV NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN}" \
    SENTRY_ORG="" \
    SENTRY_PROJECT=""

# Posthog
ENV NEXT_PUBLIC_ANALYTICS_POSTHOG="${NEXT_PUBLIC_ANALYTICS_POSTHOG}" \
    NEXT_PUBLIC_POSTHOG_HOST="${NEXT_PUBLIC_POSTHOG_HOST}" \
    NEXT_PUBLIC_POSTHOG_KEY="${NEXT_PUBLIC_POSTHOG_KEY}"

# Umami
ENV NEXT_PUBLIC_ANALYTICS_UMAMI="${NEXT_PUBLIC_ANALYTICS_UMAMI}" \
    NEXT_PUBLIC_UMAMI_SCRIPT_URL="${NEXT_PUBLIC_UMAMI_SCRIPT_URL}" \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID}"

# Prebuild: env checks then remove desktop-only code（合并为一个 RUN，减少镜像层）。
RUN pnpm exec tsx scripts/dockerPrebuild.mts && \
    rm -rf src/app/desktop "src/app/(backend)/trpc/desktop"

# 构建：挂载 .next/cache 与 node_modules/.cache，二次构建走增量编译。
# 【新增】node_modules/.cache 挂载：babel / terser 等构建工具缓存跨构建复用。
RUN --mount=type=cache,id=masterlion-next-cache,target=/app/.next/cache,sharing=locked \
    --mount=type=cache,id=masterlion-build-cache,target=/app/node_modules/.cache,sharing=locked \
    npm run build:docker

## Application image, copy all the files for production
FROM busybox:latest AS app

COPY --from=base /distroless/ /

# 先创建用户，再 COPY --chown，避免最后 chown -R /app 生成大 layer。
RUN set -e && \
    addgroup -S -g 1001 nodejs && \
    adduser -D -G nodejs -H -S -h /app -u 1001 nextjs && \
    chown nextjs:nodejs /etc/proxychains4.conf

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone /app/
COPY --chown=nextjs:nodejs --from=builder /app/.next/static /app/.next/static
# Copy SPA assets (Vite build output)
COPY --chown=nextjs:nodejs --from=builder /app/public/_spa /app/public/_spa
# Copy database migrations
COPY --chown=nextjs:nodejs --from=builder /app/packages/database/migrations /app/migrations
COPY --chown=nextjs:nodejs --from=builder /app/scripts/migrateServerDB/docker.cjs /app/docker.cjs
COPY --chown=nextjs:nodejs --from=builder /app/scripts/migrateServerDB/errorHint.js /app/errorHint.js

# copy dependencies
COPY --chown=nextjs:nodejs --from=builder /deps/node_modules/.pnpm /app/node_modules/.pnpm
COPY --chown=nextjs:nodejs --from=builder /deps/node_modules/pg /app/node_modules/pg
COPY --chown=nextjs:nodejs --from=builder /deps/node_modules/drizzle-orm /app/node_modules/drizzle-orm

# Copy server launcher and shared scripts
COPY --chown=nextjs:nodejs --from=builder /app/scripts/serverLauncher/startServer.js /app/startServer.js
COPY --chown=nextjs:nodejs --from=builder /app/scripts/_shared /app/scripts/_shared

## Production image
# 不再用 scratch + COPY / / 压成一个大层；直接 FROM app 保留分层，push/pull 更容易复用 layer。
FROM app AS production

ENV NODE_ENV="production" \
    NODE_OPTIONS="--dns-result-order=ipv4first --use-openssl-ca" \
    NODE_EXTRA_CA_CERTS="" \
    NODE_TLS_REJECT_UNAUTHORIZED="" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

# Make the middleware rewrite through local as default
# refs: https://github.com/lobehub/lobehub/issues/5876
ENV MIDDLEWARE_REWRITE_THROUGH_LOCAL="1"

# set hostname to localhost
ENV HOSTNAME="0.0.0.0" \
    PORT="3210"

# General Variables
ENV APP_URL="" \
    API_KEY_SELECT_MODE="" \
    DEFAULT_AGENT_CONFIG="" \
    SYSTEM_AGENT="" \
    FEATURE_FLAGS="" \
    PROXY_URL=""

# Database
ENV KEY_VAULTS_SECRET="" \
    DATABASE_DRIVER="node" \
    DATABASE_URL=""

# Better Auth
ENV AUTH_SECRET="" \
    AUTH_SSO_PROVIDERS="" \
    AUTH_ALLOWED_EMAILS="" \
    AUTH_TRUSTED_ORIGINS="" \
    AUTH_DISABLE_EMAIL_PASSWORD="" \
    AUTH_EMAIL_VERIFICATION="" \
    AUTH_ENABLE_MAGIC_LINK="" \
    # Google
    AUTH_GOOGLE_ID="" \
    AUTH_GOOGLE_SECRET="" \
    # GitHub
    AUTH_GITHUB_ID="" \
    AUTH_GITHUB_SECRET="" \
    # Microsoft
    AUTH_MICROSOFT_ID="" \
    AUTH_MICROSOFT_SECRET="" \
    AUTH_MICROSOFT_AUTHORITY_URL="" \
    AUTH_MICROSOFT_TENANT_ID=""

# Redis
ENV REDIS_URL="" \
    REDIS_PREFIX="" \
    REDIS_TLS=""

# Email
ENV EMAIL_SERVICE_PROVIDER="" \
    SMTP_HOST="" \
    SMTP_PORT="" \
    SMTP_SECURE="" \
    SMTP_USER="" \
    SMTP_PASS="" \
    SMTP_FROM="" \
    RESEND_API_KEY="" \
    RESEND_FROM=""

# S3
ENV NEXT_PUBLIC_S3_DOMAIN="" \
    S3_PUBLIC_DOMAIN="" \
    S3_ACCESS_KEY_ID="" \
    S3_BUCKET="" \
    S3_ENDPOINT="" \
    S3_SECRET_ACCESS_KEY="" \
    S3_ENABLE_PATH_STYLE="" \
    S3_SET_ACL=""

# Cloud Sandbox
ENV SANDBOX_PROVIDER="" \
    ONLYBOXES_BASE_URL="" \
    ONLYBOXES_JIT_ISSUER="" \
    ONLYBOXES_JIT_SIGNING_KEY="" \
    ONLYBOXES_JIT_TTL_SEC="" \
    ONLYBOXES_LEASE_TTL_SEC=""

# Model Variables
ENV \
    # AI21
    AI21_API_KEY="" AI21_MODEL_LIST="" \
    # Ai360
    AI360_API_KEY="" AI360_MODEL_LIST="" \
    # AiHubMix
    AIHUBMIX_API_KEY="" AIHUBMIX_MODEL_LIST="" \
    # Anthropic
    ANTHROPIC_API_KEY="" ANTHROPIC_CLIENT_TIMEOUT="" ANTHROPIC_MODEL_LIST="" ANTHROPIC_PROXY_URL="" \
    # Amazon Bedrock
    ENABLED_AWS_BEDROCK="" AWS_ACCESS_KEY_ID="" AWS_SECRET_ACCESS_KEY="" AWS_REGION="" AWS_BEDROCK_MODEL_LIST="" \
    # Azure OpenAI
    AZURE_API_KEY="" AZURE_API_VERSION="" AZURE_ENDPOINT="" AZURE_MODEL_LIST="" \
    # Baichuan
    BAICHUAN_API_KEY="" BAICHUAN_MODEL_LIST="" \
    # Cloudflare
    CLOUDFLARE_API_KEY="" CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID="" CLOUDFLARE_MODEL_LIST="" \
    # Cohere
    COHERE_API_KEY="" COHERE_MODEL_LIST="" COHERE_PROXY_URL="" \
    # ComfyUI
    ENABLED_COMFYUI="" COMFYUI_BASE_URL="" COMFYUI_AUTH_TYPE="" \
    COMFYUI_API_KEY="" COMFYUI_USERNAME="" COMFYUI_PASSWORD="" COMFYUI_CUSTOM_HEADERS="" \
    # DeepSeek
    DEEPSEEK_API_KEY="" DEEPSEEK_MODEL_LIST="" \
    # Fireworks AI
    FIREWORKSAI_API_KEY="" FIREWORKSAI_MODEL_LIST="" \
    # Gitee AI
    GITEE_AI_API_KEY="" GITEE_AI_MODEL_LIST="" \
    # GitHub
    GITHUB_TOKEN="" GITHUB_MODEL_LIST="" \
    # Google
    GOOGLE_API_KEY="" GOOGLE_MODEL_LIST="" GOOGLE_PROXY_URL="" \
    # Vertex AI
    VERTEXAI_CREDENTIALS="" VERTEXAI_PROJECT="" VERTEXAI_LOCATION="" VERTEXAI_MODEL_LIST="" \
    # Groq
    GROQ_API_KEY="" GROQ_MODEL_LIST="" GROQ_PROXY_URL="" \
    # Higress
    HIGRESS_API_KEY="" HIGRESS_MODEL_LIST="" HIGRESS_PROXY_URL="" \
    # HuggingFace
    HUGGINGFACE_API_KEY="" HUGGINGFACE_MODEL_LIST="" HUGGINGFACE_PROXY_URL="" \
    # Hunyuan
    HUNYUAN_API_KEY="" HUNYUAN_MODEL_LIST="" \
    # InternLM
    INTERNLM_API_KEY="" INTERNLM_MODEL_LIST="" \
    # Jina
    JINA_API_KEY="" JINA_MODEL_LIST="" JINA_PROXY_URL="" \
    # Minimax
    MINIMAX_API_KEY="" MINIMAX_MODEL_LIST="" \
    # Mistral
    MISTRAL_API_KEY="" MISTRAL_MODEL_LIST="" \
    # ModelScope
    MODELSCOPE_API_KEY="" MODELSCOPE_MODEL_LIST="" MODELSCOPE_PROXY_URL="" \
    # Moonshot
    MOONSHOT_API_KEY="" MOONSHOT_MODEL_LIST="" MOONSHOT_PROXY_URL="" \
    # Nebius
    NEBIUS_API_KEY="" NEBIUS_MODEL_LIST="" NEBIUS_PROXY_URL="" \
    # NewAPI / Aihub
    NEWAPI_API_KEY="" NEWAPI_ADMIN_ACCESS_TOKEN="" NEWAPI_ADMIN_USER_ID="" NEWAPI_DATA_SOURCE="" NEWAPI_DEFAULT_MODEL="" NEWAPI_MANAGED_TOKEN_NAME="" NEWAPI_PROXY_URL="" NEWAPI_READONLY_DATABASE_URL="" NEWAPI_USAGE_PAGE_SIZE="" \
    AIHUB_ADMIN_ACCESS_TOKEN="" AIHUB_ADMIN_USER_ID="" AIHUB_BRIDGE_TOKEN="" AIHUB_BRIDGE_URL="" AIHUB_DATA_SOURCE="" AIHUB_DEFAULT_MODEL="" AIHUB_MANAGED_TOKEN_NAME="" AIHUB_PROXY_URL="" AIHUB_READONLY_DATABASE_URL="" AIHUB_USAGE_PAGE_SIZE="" \
    # Novita
    NOVITA_API_KEY="" NOVITA_MODEL_LIST="" \
    # Nvidia NIM
    NVIDIA_API_KEY="" NVIDIA_MODEL_LIST="" NVIDIA_PROXY_URL="" \
    # Ollama
    ENABLED_OLLAMA="" OLLAMA_MODEL_LIST="" OLLAMA_PROXY_URL="" \
    # OpenAI
    ENABLED_OPENAI="" OPENAI_API_KEY="" OPENAI_MODEL_LIST="" OPENAI_PROXY_URL="" \
    # OpenRouter
    OPENROUTER_API_KEY="" OPENROUTER_MODEL_LIST="" \
    # Perplexity
    PERPLEXITY_API_KEY="" PERPLEXITY_MODEL_LIST="" PERPLEXITY_PROXY_URL="" \
    # PPIO
    PPIO_API_KEY="" PPIO_MODEL_LIST="" \
    # Qiniu
    QINIU_API_KEY="" QINIU_MODEL_LIST="" QINIU_PROXY_URL="" \
    # Qwen
    QWEN_API_KEY="" QWEN_MODEL_LIST="" QWEN_PROXY_URL="" \
    # SambaNova
    SAMBANOVA_API_KEY="" SAMBANOVA_MODEL_LIST="" \
    # Search1API
    SEARCH1API_API_KEY="" SEARCH1API_MODEL_LIST="" \
    # SenseNova
    SENSENOVA_API_KEY="" SENSENOVA_MODEL_LIST="" \
    # SiliconCloud
    SILICONCLOUD_API_KEY="" SILICONCLOUD_MODEL_LIST="" SILICONCLOUD_PROXY_URL="" \
    # Spark
    SPARK_API_KEY="" SPARK_MODEL_LIST="" SPARK_PROXY_URL="" SPARK_SEARCH_MODE="" \
    # Stepfun
    STEPFUN_API_KEY="" STEPFUN_MODEL_LIST="" \
    # Taichu
    TAICHU_API_KEY="" TAICHU_MODEL_LIST="" \
    # TogetherAI
    TOGETHERAI_API_KEY="" TOGETHERAI_MODEL_LIST="" \
    # Upstage
    UPSTAGE_API_KEY="" UPSTAGE_MODEL_LIST="" \
    # v0 (Vercel)
    V0_API_KEY="" V0_MODEL_LIST="" \
    # vLLM
    VLLM_API_KEY="" VLLM_MODEL_LIST="" VLLM_PROXY_URL="" \
    # Wenxin
    WENXIN_API_KEY="" WENXIN_MODEL_LIST="" \
    # xAI
    XAI_API_KEY="" XAI_MODEL_LIST="" XAI_PROXY_URL="" \
    # Xinference
    XINFERENCE_API_KEY="" XINFERENCE_MODEL_LIST="" XINFERENCE_PROXY_URL="" \
    # 01.AI
    ZEROONE_API_KEY="" ZEROONE_MODEL_LIST="" \
    # Zhipu
    ZHIPU_API_KEY="" ZHIPU_MODEL_LIST="" \
    # Tencent Cloud
    TENCENT_CLOUD_API_KEY="" TENCENT_CLOUD_MODEL_LIST="" \
    # Infini-AI
    INFINIAI_API_KEY="" INFINIAI_MODEL_LIST="" \
    # 302.AI
    AI302_API_KEY="" AI302_MODEL_LIST="" \
    # FAL
    ENABLED_FAL="" FAL_API_KEY="" FAL_MODEL_LIST="" \
    # BFL
    BFL_API_KEY="" BFL_MODEL_LIST="" \
    # Vercel AI Gateway
    VERCELAIGATEWAY_API_KEY="" VERCELAIGATEWAY_MODEL_LIST="" \
    # Cerebras
    CEREBRAS_API_KEY="" CEREBRAS_MODEL_LIST=""

USER nextjs

EXPOSE 3210/tcp

ENTRYPOINT ["/bin/node"]

CMD ["/app/startServer.js"]
