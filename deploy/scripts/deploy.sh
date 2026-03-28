#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/komodo-marketmaker-gui}"
SERVICE_NAME="${SERVICE_NAME:-komodo-marketmaker-gui}"

cd "$APP_DIR"

echo "[deploy] git pull"
git pull --ff-only

echo "[deploy] npm ci"
npm ci

echo "[deploy] typecheck"
npm run typecheck

echo "[deploy] lint"
npm run lint

echo "[deploy] build"
npm run build

echo "[deploy] restart systemd service: ${SERVICE_NAME}"
sudo systemctl restart "$SERVICE_NAME"

echo "[deploy] service status"
sudo systemctl --no-pager --full status "$SERVICE_NAME"

echo "[deploy] done"
