#!/bin/bash
set -e

echo "🛡️ Sentinel Setup"
echo "=================="

# Check prereqs
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ docker required"; exit 1; }

# Install deps
echo "📦 Installing dependencies..."
pnpm install

# Create .env if missing
if [ ! -f .env ]; then
  echo "📝 Creating .env from template..."
  cp .env.example .env
  echo "⚠️  Edit .env to add your ENVIO_ENDPOINT"
fi

# Create delivery .env if missing
if [ ! -f packages/delivery/.env ]; then
  echo "📝 Creating packages/delivery/.env from template..."
  cp packages/delivery/.env.example packages/delivery/.env
  echo "⚠️  Edit packages/delivery/.env to add TELEGRAM_BOT_TOKEN"
fi

# Start full Docker stack
echo "🐳 Starting full stack (postgres, redis, api, worker, delivery)..."
docker compose up --build -d

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env (add ENVIO_ENDPOINT, RPC URLs, WEBHOOK_SECRET)"
echo "  2. Edit packages/delivery/.env (add TELEGRAM_BOT_TOKEN, matching WEBHOOK_SECRET)"
echo "  3. Restart stack if env changed: docker compose up --build -d"
echo ""
echo "Test with:"
echo "  curl http://localhost:3000/health"
echo "  curl http://localhost:3100/health"
