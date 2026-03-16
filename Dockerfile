FROM node:20-alpine

WORKDIR /app

# ── Build React client ────────────────────────────────────────────────────────
COPY client/package*.json ./client/
RUN cd client && npm install --legacy-peer-deps

COPY client/ ./client/
RUN cd client && npm run build

# ── Install server deps ───────────────────────────────────────────────────────
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# ── Copy server source ────────────────────────────────────────────────────────
COPY server/ ./server/

EXPOSE 5000

CMD ["node", "server/src/index.js"]
