#!/usr/bin/env bash
# P1 DX 8.4 — Local development setup script
# Usage: ./scripts/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔧 RemitFlow Development Setup"
echo "================================"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required. Install from https://nodejs.org/"; exit 1; }
command -v docker >/dev/null 2>&1 || echo "⚠️  Docker not found — some services won't be available"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required, found $(node -v)"
  exit 1
fi

cd "$PROJECT_DIR"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Environment setup
if [ ! -f .env ]; then
  echo "📝 Creating .env from .env.example..."
  cp .env.example .env
  echo "⚠️  Edit .env with your credentials before running the app"
fi

# Pre-commit hooks
echo "🪝 Setting up pre-commit hooks..."
npx husky || true

# Docker services (if available)
if command -v docker >/dev/null 2>&1; then
  echo "🐳 Starting core Docker services..."
  docker compose --profile core up -d 2>/dev/null || echo "⚠️  Docker compose failed — continuing without Docker services"
fi

# Type check
echo "🔍 Running TypeScript check..."
npx tsc --noEmit || echo "⚠️  TypeScript errors found — check output above"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start the dev server: npm run dev"
echo "Run tests: npm test"
echo "Run type check: npx tsc --noEmit"
