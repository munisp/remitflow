FROM python:3.12-slim-bookworm AS base

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
# stdlib-only service; requirements.txt documents the optional geolib engine.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS runtime
COPY . .
ENV GEO_PORT=8114 \
    PYTHONUNBUFFERED=1
EXPOSE 8114
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:8114/health || exit 1
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser && \
    chown -R appuser:appgroup /app
USER appuser

CMD ["python3", "main.py"]
