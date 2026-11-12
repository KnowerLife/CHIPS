# CHIPS — production image.
#
# Two stages:
#   1. build  — install dev deps and bundle the Phaser client into ./dist
#   2. run    — tiny Node image that serves ./dist and the /api + SSE backend.
#
# The backend has **zero runtime dependencies** (plain Node ESM + `node:http`),
# so the final image ships no node_modules at all.

# ── stage 1: build the frontend ─────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── stage 2: run the game server ────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/index.mjs"]
