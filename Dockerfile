# One container: Node serves the built site and the /api/setups sync API.
# Saved games live in the /data volume; back that up.
#
#   docker build -t htb .
#   docker run -p 3000:3000 -v htb-data:/data [-e ACCESS_CODE=...] htb

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Sprites are downloaded here rather than committed. Docker re-runs this layer
# only when the dex or the script changes, so a normal rebuild doesn't refetch.
COPY data/dex.json data/dex.json
COPY scripts/fetch-sprites.mjs scripts/fetch-sprites.mjs
RUN node scripts/fetch-sprites.mjs

COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DIST_DIR=/app/dist DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server/index.mjs ./server/index.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.mjs"]
