FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
EXPOSE 8092
ENV PYTHONUNBUFFERED=1
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:8092/health || exit 1
CMD ["python", "src/main.py"]
