FROM python:3.11-slim

WORKDIR /app

# System deps for building torch/onnxruntime
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY ../shared/platform_data_loader.py /app/

ENV GPU_ENGINE_PORT=8120
EXPOSE 8120

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8120/health')"

CMD ["python", "main.py"]
