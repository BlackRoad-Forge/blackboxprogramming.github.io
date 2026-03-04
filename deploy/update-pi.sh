#!/usr/bin/env bash
set -euo pipefail

# Quick update script — pull latest code and restart on Pi
APP_DIR="${APP_DIR:-/opt/blackroad-stripe}"
APP_USER="${APP_USER:-blackroad}"

echo "Updating BlackRoad Stripe server..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && git pull origin main && npm ci --production"
sudo systemctl restart blackroad-stripe
echo "Done. Status: $(systemctl is-active blackroad-stripe)"
sudo journalctl -u blackroad-stripe -n 5 --no-pager
