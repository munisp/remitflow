FROM python:3.12-slim-bookworm AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS runtime
COPY . .
ENV PORT=8083 \
    PYTHONUNBUFFERED=1 \
    KAFKA_BROKERS=kafka:9092 \
    REDIS_URL=redis://redis:6379
EXPOSE 8083
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8083/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8083", "--workers", "2"]
