FROM python:3.11-slim

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8231

# Trust anchor material is NOT baked into the image. Mount a master list at
# CSCA_MASTERLIST_PATH (download it with scripts/fetch_masterlist.py in an
# initContainer / cron sidecar) or the service fails closed (503 on /verify).
ENV CSCA_MASTERLIST_PATH=/app/data/masterlist.ml
ENV PORT=8231

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser && \
    mkdir -p /app/data && \
    chown -R appuser:appgroup /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen(f\"http://localhost:{os.environ.get('PORT','8231')}/health\").read()" || exit 1

CMD ["python", "main.py"]
