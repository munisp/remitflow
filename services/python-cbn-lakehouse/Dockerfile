FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.111.0 uvicorn[standard]==0.29.0 asyncpg==0.29.0 httpx==0.27.0 pydantic==2.7.1
COPY main.py .
ENV PORT=8099
EXPOSE 8099
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8099/health')"
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8099"]
