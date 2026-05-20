#!/bin/bash

set -e

echo "=========================================="
echo "Nigerian Remittance Platform Deployment"
echo "=========================================="

# Build images
echo "Building Docker images..."
docker-compose build

# Run database migrations
echo "Running database migrations..."
docker-compose run --rm backend alembic upgrade head

# Start services
echo "Starting services..."
docker-compose up -d

# Wait for services
echo "Waiting for services to be ready..."
sleep 10

# Health check
echo "Running health checks..."
curl -f http://localhost:8000/health || exit 1
curl -f http://localhost:3000 || exit 1

echo "=========================================="
echo "✅ Deployment complete!"
echo "=========================================="
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo "Docs: http://localhost:8000/docs"
