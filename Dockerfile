# Use an official Node runtime as the base image
FROM node:24-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS base
WORKDIR /usr/src/app

# Build stage - install all dependencies and build.
FROM base AS build
ENV HUSKY=0
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json ./
COPY vite.config.ts ./
COPY eslint.config.js ./
COPY index.html ./
COPY .bundlewatch.json ./
COPY Dockerfile supervisord.conf update.sh ./
COPY .github ./.github
COPY config ./config
COPY context ./context
COPY docs ./docs
COPY public ./public
COPY resources ./resources
COPY proprietary ./proprietary
COPY scripts ./scripts
COPY src ./src

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"
RUN npm run build-prod

# Production dependencies stage - separate from build.
FROM base AS prod-deps
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Final production image. Host-level Traefik is the only ingress authority.
FROM base

RUN apt-get update && apt-get install -y nginx curl supervisor apache2-utils && rm -rf /var/lib/apt/lists/*
RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf

RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf /etc/nginx/snippets/vaultfront-security-headers.conf
RUN rm -f /etc/nginx/sites-enabled/default

COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /usr/src/app/static ./static
COPY resources ./resources
RUN rm -rf ./resources/maps
COPY tsconfig.json ./
COPY src ./src

ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision="$GIT_COMMIT"
RUN echo "$GIT_COMMIT" > static/commit.txt
ENV GIT_COMMIT="$GIT_COMMIT"

# The container owns Nginx + Node only. It never creates provider tunnels,
# receives Cloudflare control-plane credentials, or mutates DNS at runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1/_health || exit 1
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
