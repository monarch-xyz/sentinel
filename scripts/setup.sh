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
  # Fix the DB name (template says 'flare', we want 'sentinel')
  sed -i '' 's/flare/sentinel/g' .env 2>/dev/null || sed -i 's/flare/sentinel/g' .env
  echo "⚠️  Edit .env to add your ENVIO_ENDPOINT"
fi

# Create delivery .env if missing
if [ ! -f packages/delivery/.env ]; then
  echo "📝 Creating packages/delivery/.env from template..."
  cp packages/delivery/.env.example packages/delivery/.env
  echo "⚠️  Edit packages/delivery/.env to add TELEGRAM_BOT_TOKEN"
fi

# Start Docker services
echo "🐳 Starting PostgreSQL + Redis..."
docker compose up -d

# Wait for postgres
echo "⏳ Waiting for PostgreSQL..."
sleep 3

# Run migrations
echo "🗃️ Running migrations..."
pnpm db:migrate 2>/dev/null || {
  echo "⚠️  Migration failed (maybe first run). Trying again..."
  sleep 2
  pnpm db:migrate
}

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env (add ENVIO_ENDPOINT, RPC URLs)"
echo "  2. Edit packages/delivery/.env (add TELEGRAM_BOT_TOKEN)"
echo "  3. Run: pnpm dev"
echo ""
echo "Test with:"
echo "  curl http://localhost:3000/health"
