# ─────────────────────────────────────────────────────────────────────────────
# RemitFlow Mobile App — Build Container
#
# This Dockerfile is used for:
#   1. Running tests and linting in CI/CD
#   2. Generating a web export (Expo web) for preview environments
#   3. Building the Android APK/AAB via Expo EAS (triggered from CI/CD)
#
# For production iOS/Android builds, use Expo EAS Build:
#   npx eas build --platform android --profile production
#   npx eas build --platform ios --profile production
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS base

WORKDIR /app

# Install system dependencies for React Native
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    openjdk11-jre-headless

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# Copy source
COPY . .

# ─────────────────────────────────────────────────────────────────────────────
# Stage: Test & Lint
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS test

RUN npm run lint
RUN npm test -- --watchAll=false --passWithNoTests

# ─────────────────────────────────────────────────────────────────────────────
# Stage: Web Export (for preview/staging environments)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS web-export

ARG EXPO_PUBLIC_API_URL=https://api.remitflow.com
ARG EXPO_PUBLIC_APP_ENV=production
ARG EXPO_PUBLIC_SENTRY_DSN=""

ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_APP_ENV=$EXPO_PUBLIC_APP_ENV
ENV EXPO_PUBLIC_SENTRY_DSN=$EXPO_PUBLIC_SENTRY_DSN

# Install Expo CLI
RUN npm install -g @expo/cli

# Export static web build
RUN npx expo export --platform web --output-dir /app/web-build

# ─────────────────────────────────────────────────────────────────────────────
# Stage: Serve web export with Nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS serve

COPY --from=web-export /app/web-build /usr/share/nginx/html

# Nginx config for SPA
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    add_header X-Frame-Options "DENY" always;\n\
    add_header X-Content-Type-Options "nosniff" always;\n\
    add_header Content-Security-Policy "default-src '\''self'\''; script-src '\''self'\'' '\''unsafe-inline'\''; style-src '\''self'\'' '\''unsafe-inline'\''; connect-src '\''self'\'' https://api.remitflow.com;" always;\n\
    location /health {\n\
        return 200 '\''{"status":"ok","service":"mobile-web"}'\''; \n\
        add_header Content-Type application/json;\n\
    }\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
