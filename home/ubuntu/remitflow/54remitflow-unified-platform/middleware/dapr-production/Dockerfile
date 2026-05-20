FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/
COPY components/ ./components/
COPY config/ ./config/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV DAPR_HTTP_PORT=3500
ENV DAPR_GRPC_PORT=50001

# Expose application port
EXPOSE 5000

# Run application
CMD ["python", "-m", "src.main"]

