# ============================================================
# RemitFlow — Production Dockerfile v85.0.0
# Multi-stage build: builder + production runner
# Build:  docker build -t remitflow:v85 .
# Run:    docker compose up -d
# ============================================================

# ---- Stage 1: Build ----
FROM node:26-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"


WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the client (Vite) and server (esbuild/tsc)
RUN pnpm build

# ---- Stage 2: Production Runner ----
FROM node:26-alpine AS runner

# Metadata labels
LABEL maintainer="remitflow@example.com"
LABEL version="85.0.0"
LABEL description="RemitFlow Cross-Border Remittance Platform"
LABEL org.opencontainers.image.title="RemitFlow"
LABEL org.opencontainers.image.version="85.0.0"
LABEL org.opencontainers.image.description="Production-grade cross-border remittance platform"

WORKDIR /app

# Install pnpm and wget (for healthcheck)
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache wget curl

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 remitflow

# Copy package files and install production deps only
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/drizzle ./drizzle

# Copy scripts
COPY scripts/ ./scripts/

# Set ownership
RUN chown -R remitflow:nodejs /app

USER remitflow

# Expose port
EXPOSE 3000

# Health check — uses /health endpoint (no auth required)
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Environment defaults (override in docker-compose or K8s)
ENV NODE_ENV=production \
    PORT=3000

# Start the server
CMD ["node", "dist/server/index.js"]
