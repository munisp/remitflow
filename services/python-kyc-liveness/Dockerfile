FROM python:3.11-slim

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

COPY . .

EXPOSE 8095

# LIVENESS_PROVIDER: minifasnet (default, open-source) | iproov | onfido
ENV LIVENESS_PROVIDER=minifasnet
ENV PORT=8095

CMD ["python", "main.py"]
