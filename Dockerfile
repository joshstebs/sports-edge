FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca NODE_USE_ENV_PROXY=1; \
    fi && npm ci && npm ci --prefix server

COPY . .
RUN npm run build && npm run build:server && npm prune --omit=dev --prefix server

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SPORTS_EDGE_DATA_DIR=/data
WORKDIR /app
RUN install -d -o node -g node /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
RUN chmod -R a+rX /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server/dist/production.js"]
