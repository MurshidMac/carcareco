#!/bin/bash
set -e

export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH

APPSETTINGS=backend/src/Carmasters.Http.Api/appsettings.Secrets.json
ENVFILE=frontend/.env

# ── 1. Generate secrets if they don't exist ──────────────────────────
if [ ! -f "$APPSETTINGS" ] || [ ! -f "$ENVFILE" ]; then
  echo "⚙️  Secrets not found — generating..."
  chmod +x scripts/setup-secrets.sh
  ./scripts/setup-secrets.sh
else
  echo "✅ Secrets already exist"
fi

# ── 2. Start all services via Docker Compose ─────────────────────────
echo "🚀 Starting Docker containers..."
docker compose up --build -d

# ── 3. Wait for services to be healthy ───────────────────────────────
echo "⏳ Waiting for services to start..."
sleep 5

# ── 4. Print access information ──────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  CarCare is running locally!"
echo "═══════════════════════════════════════════════"
echo "  🌐 UI:           http://localhost:3000"
echo "  🔌 API (Swagger): http://localhost:15567"
echo "  📧 Mail preview:  http://localhost:8025"
echo "  🗄️  PostgreSQL:    localhost:5432"
echo ""
echo "  🔐 Default login:"
echo "     Username: admin"
echo "     Password: carcare"
echo "═══════════════════════════════════════════════"
