# 家庭记账本 — NAS / 单机 Docker 部署
# 前端 + API 同容器，数据目录挂载到 /data

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    LISTEN_HOST=0.0.0.0 \
    DB_PATH=/data/ledger.db \
    GEAR_IMG_DIR=/data/gear-images \
    TRAVEL_IMG_DIR=/data/travel-images \
    TRAVEL_FILE_DIR=/data/travel-files \
    INVOICE_DIR=/data/invoices \
    FAMILY_EVENT_DIR=/data/family-events \
    TESSERACT_CACHE=/data/tesseract-cache

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/import-manager.js ./src/import-manager.js
COPY public ./public

RUN mkdir -p /data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
