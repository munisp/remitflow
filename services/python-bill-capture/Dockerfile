# RemitFlow Bill Capture (Wave 10 C3) — stdlib HTTP service + optional OCR engines
# Mirrors the sibling python services (services/python-kyc-pipeline/Dockerfile,
# services/python-anomaly-detector/Dockerfile): slim base, non-root, healthcheck.
FROM python:3.11-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libglib2.0-0 libsm6 libxext6 libxrender-dev \
    libgomp1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libgl1 curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser appuser
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY main.py ocr_engine.py bill_fields.py fluvio_client.py ./

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8112
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8112/health || exit 1

CMD ["python3", "main.py"]
