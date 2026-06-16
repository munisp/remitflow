FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python -c "from main import train_all_models; train_all_models()"
EXPOSE 8113
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8113/health || exit 1
CMD ["python", "main.py"]
