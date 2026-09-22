FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim

ARG BUILD_SHA=dev
LABEL org.opencontainers.image.title="Solar Dashboard" \
      org.opencontainers.image.description="Fronius solar dashboard: can we run the washer on sunshine right now?" \
      org.opencontainers.image.source="https://github.com/dubberness/solar-dashboard" \
      org.opencontainers.image.revision="${BUILD_SHA}"

# tini for signal handling, gosu to drop to PUID/PGID the way Unraid expects.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini gosu tzdata && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /config

# BODY_SIZE_LIMIT covers Solar.web .xlsx uploads (a year is well under 1 MB).
ENV NODE_ENV=production \
    BUILD_SHA=${BUILD_SHA} \
    PUID=99 \
    PGID=100 \
    TZ=Australia/Hobart \
    DATA_DIR=/config \
    HOST=0.0.0.0 \
    PORT=8080 \
    BODY_SIZE_LIMIT=20M

EXPOSE 8080
VOLUME ["/config"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["node", "build"]
