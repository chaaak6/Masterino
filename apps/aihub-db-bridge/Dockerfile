ARG NODEJS_VERSION="24"

FROM node:${NODEJS_VERSION}-slim AS builder

ENV NODE_ENV="development"

WORKDIR /workspace/apps/aihub-db-bridge

COPY tsconfig.json /workspace/tsconfig.json
COPY apps/aihub-db-bridge/package.json ./

RUN --mount=type=cache,id=aihub-db-bridge-npm-cache,target=/root/.npm,sharing=locked \
    npm install

COPY apps/aihub-db-bridge/tsconfig.json ./tsconfig.json
COPY apps/aihub-db-bridge/src ./src

RUN npm run build

FROM node:${NODEJS_VERSION}-slim AS runtime

ENV NODE_ENV="production" \
    PORT="3218"

WORKDIR /app

COPY apps/aihub-db-bridge/package.json ./

RUN --mount=type=cache,id=aihub-db-bridge-npm-cache,target=/root/.npm,sharing=locked \
    npm install --omit=dev

COPY --from=builder /workspace/apps/aihub-db-bridge/dist ./dist

USER node

EXPOSE 3218

CMD ["node", "dist/index.js"]
