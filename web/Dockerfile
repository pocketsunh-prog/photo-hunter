# API + static SPA container for the photo-hunter web app.
# Build context is web/, so only the web app, its data/levels seed and the
# public/ assets (images + audio, mirrored by tools/prepare_assets.py) are shipped.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV PORT=4000 LEVELS_DIR=/app/data/levels
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
