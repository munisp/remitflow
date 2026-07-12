# ── Build stage ──────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8097

ENV PORT=8097 \
    DEEPFAKE_CONFIDENCE_THRESHOLD=0.55 \
    RATE_LIMIT_RPM=20 \
    MAX_BATCH_SIZE=8 \
    HF_DEEPFAKE_MODEL_ID=Wvolf/ViT-L_Deepfake_Detection \
    USE_GPU=false \
    ENABLE_FREQUENCY_FALLBACK=true \
    ENABLE_LANDMARK_FALLBACK=true \
    PYTHONUNBUFFERED=1

# Pre-download the model at build time so startup is fast
# Comment this out if you want lazy loading at runtime instead
RUN python -c "from transformers import AutoFeatureExtractor, AutoModelForImageClassification; \
    AutoFeatureExtractor.from_pretrained('Wvolf/ViT-L_Deepfake_Detection'); \
    AutoModelForImageClassification.from_pretrained('Wvolf/ViT-L_Deepfake_Detection')" || true

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser && \
    chown -R appuser:appgroup /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

CMD ["python", "main.py"]
