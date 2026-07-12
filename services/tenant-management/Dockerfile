FROM node:18-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run clean

RUN npm run build

ENV NODE_ENV=production

RUN chown -R node /app

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:80/health || exit 1

CMD ["npm", "start"]
