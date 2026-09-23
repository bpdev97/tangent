# syntax=docker/dockerfile:1.7
FROM node:24.13.1-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The reduced Docker workspace intentionally omits unrelated patched packages. Dependencies are
# installed explicitly below, so prevent `vp pack` from attempting a second workspace-wide install.
ENV VP_SKIP_INSTALL=1
WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts ./
COPY patches ./patches
COPY scripts/package.json ./scripts/package.json
COPY apps/push-relay/package.json ./apps/push-relay/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @bpdev/push-relay...

COPY apps/push-relay ./apps/push-relay
COPY packages/contracts ./packages/contracts
RUN cd apps/push-relay && ./node_modules/.bin/vp pack

FROM node:24.13.1-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node /app /data
COPY --from=build --chown=node:node /workspace/apps/push-relay/dist/main.mjs /app/main.mjs

USER node
EXPOSE 8788
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8788/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "/app/main.mjs"]
