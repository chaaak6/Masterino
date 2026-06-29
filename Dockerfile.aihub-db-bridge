ARG NODEJS_VERSION="24"
ARG BASE_REGISTRY="docker.io/library"

FROM ${BASE_REGISTRY}/node:${NODEJS_VERSION}-slim AS builder

ARG USE_CN_MIRROR

ENV NODE_ENV="development"

WORKDIR /workspace/apps/aihub-db-bridge

COPY tsconfig.json /workspace/tsconfig.json
COPY apps/aihub-db-bridge/package.json ./

RUN --mount=type=cache,id=aihub-db-bridge-npm-cache,target=/root/.npm,sharing=locked \
    set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        npm config set registry "https://registry.npmmirror.com/"; \
    fi && \
    npm install

COPY apps/aihub-db-bridge/tsconfig.json ./tsconfig.json
COPY apps/aihub-db-bridge/src ./src

RUN npm run build

FROM ${BASE_REGISTRY}/node:${NODEJS_VERSION}-slim AS runtime

ARG USE_CN_MIRROR

ENV NODE_ENV="production" \
    PORT="3218"

WORKDIR /app

COPY apps/aihub-db-bridge/package.json ./

RUN --mount=type=cache,id=aihub-db-bridge-npm-cache,target=/root/.npm,sharing=locked \
    set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        npm config set registry "https://registry.npmmirror.com/"; \
    fi && \
    npm install --omit=dev

COPY --from=builder /workspace/apps/aihub-db-bridge/dist ./dist

USER node

EXPOSE 3218

CMD ["node", "dist/index.js"]
