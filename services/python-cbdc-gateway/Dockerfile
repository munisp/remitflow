FROM python:3.12-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12-slim
LABEL org.opencontainers.image.title="remitflow-cbdc-gateway"
LABEL org.opencontainers.image.description="RemitFlow CBDC Gateway Adapter"
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY src/ ./
ENV PATH=/root/.local/bin:$PATH
ENV PORT=8134
RUN useradd -r -u 1001 appuser && chown -R appuser /app
USER appuser
EXPOSE 8134
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8134/livez')"
CMD ["python3", "main.py"]
