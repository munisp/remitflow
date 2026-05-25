#!/usr/bin/env bash
set -euo pipefail

echo "Starting GPU Training Engine in development mode..."
echo ""

# Load .env if exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs 2>/dev/null) || true
fi

# Ensure model directories exist
mkdir -p models onnx_models

# Start backend
echo "[1/2] Starting backend on :${GPU_ENGINE_PORT:-8120}..."
PYTHONPATH="$(pwd)/backend:$(pwd)/middleware" python3 backend/server.py &
BACKEND_PID=$!

# Wait for backend health
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${GPU_ENGINE_PORT:-8120}/health" > /dev/null 2>&1; then
        echo "Backend ready"
        break
    fi
    sleep 1
done

# Start frontend
echo "[2/2] Starting frontend on :4200..."
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  GPU Training Engine running:"
echo "    Frontend: http://localhost:4200"
echo "    Backend:  http://localhost:${GPU_ENGINE_PORT:-8120}"
echo "    API Docs: http://localhost:${GPU_ENGINE_PORT:-8120}/docs"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop"

# Trap cleanup
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
