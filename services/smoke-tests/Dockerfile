FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=test \
    BASE_URL=http://app:3000
CMD ["pnpm", "test", "--reporter=verbose"]
