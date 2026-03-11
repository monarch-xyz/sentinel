#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/docker-local.sh [up|down|reset|logs] [--with-delivery]

Defaults to `up`.
`--with-delivery` starts the Telegram delivery service in addition to the core stack.
EOF
}

mode="up"
with_delivery="0"

for arg in "$@"; do
  case "$arg" in
    up|down|reset|logs)
      mode="$arg"
      ;;
    --with-delivery)
      with_delivery="1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ensure_env_file() {
  target_path="$1"
  example_path="$2"

  if [ ! -f "$target_path" ]; then
    cp "$example_path" "$target_path"
    printf 'Created %s from %s\n' "$target_path" "$example_path"
  fi
}

core_services="postgres redis main-migrate api worker"
all_services="$core_services delivery-migrate delivery"

case "$mode" in
  up)
    ensure_env_file ".env" ".env.example"
    ensure_env_file "packages/delivery/.env" "packages/delivery/.env.example"

    if [ "$with_delivery" = "1" ]; then
      echo "Starting Sentinel core + delivery services..."
      echo "Delivery requires valid TELEGRAM_BOT_TOKEN and WEBHOOK_SECRET in packages/delivery/.env."
      docker compose up --build -d $all_services
    else
      echo "Starting Sentinel core services..."
      docker compose up --build -d $core_services
    fi
    ;;
  down)
    docker compose down
    ;;
  reset)
    docker compose down -v --remove-orphans
    ;;
  logs)
    if [ "$with_delivery" = "1" ]; then
      docker compose logs -f api worker delivery
    else
      docker compose logs -f api worker
    fi
    ;;
esac
