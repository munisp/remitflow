FROM python:3.11-slim

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"


WORKDIR /app

# System deps: tesseract OCR + OpenCV headless + libgomp for ONNX Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download uniface ONNX models at build time so first request is fast
RUN python -c "from uniface import AntiSpoofing; AntiSpoofing()" 2>/dev/null || true

# Pre-download the MediaPipe Face Landmarker model asset (SPEC-wave15 §5).
# If this is missing at runtime, /challenge/validate FAILS CLOSED (503).
RUN mkdir -p /app/models && \
    python -c "import urllib.request; urllib.request.urlretrieve( \
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float32/1/face_landmarker.task', \
        '/app/models/face_landmarker.task')"

COPY . .

EXPOSE 8095

# LIVENESS_PROVIDER: minifasnet (default, open-source) | iproov | onfido
# Commercial providers are opt-in only and hard-fail without explicit creds —
# the platform default liveness path is pure OSS.
ENV LIVENESS_PROVIDER=minifasnet
ENV PORT=8095
ENV MEDIAPIPE_FACE_LANDMARKER_MODEL=/app/models/face_landmarker.task

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser && \
    chown -R appuser:appgroup /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://localhost:'+os.environ.get('PORT','8095')+'/health',timeout=8)" || exit 1

CMD ["python", "main.py"]
