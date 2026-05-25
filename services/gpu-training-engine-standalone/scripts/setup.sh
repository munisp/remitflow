#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════════════════════"
echo "  GPU Training Engine — Setup"
echo "═══════════════════════════════════════════════════════"
echo ""

# Check prerequisites
command -v python3 >/dev/null 2>&1 || { echo "python3 is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required for the frontend"; exit 1; }

# Create env file if missing
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example — edit as needed"
fi

# Backend dependencies
echo "Installing backend dependencies..."
cd backend
python3 -m pip install -r requirements.txt
cd ..

# Frontend dependencies
echo "Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Create model directories
mkdir -p models onnx_models

echo ""
echo "Setup complete. Start with:"
echo "  docker compose up          # Full stack (recommended)"
echo "  ./scripts/start-dev.sh     # Local development mode"
echo ""
