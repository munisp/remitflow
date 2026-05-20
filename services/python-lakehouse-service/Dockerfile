FROM python:3.12-slim
WORKDIR /app
COPY app/requirements.txt* ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || pip install --no-cache-dir fastapi uvicorn httpx python-jose cryptography 2>/dev/null || true
COPY app ./app
EXPOSE ${PORT:-8080}
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:${PORT:-8080}/health || exit 1
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "${PORT:-8080}"]
