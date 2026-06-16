FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8114
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8114/health || exit 1
CMD ["python", "main.py"]
