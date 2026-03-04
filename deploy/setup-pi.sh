#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# BlackRoad OS — Raspberry Pi Stripe Server Setup
# Installs Node.js, configures nginx reverse proxy, systemd service,
# and Let's Encrypt SSL for your Pi.
#
# Usage:
#   curl -sSL <this-url> | bash
#   — or —
#   bash deploy/setup-pi.sh
#
# Prerequisites:
#   - Raspberry Pi running Raspberry Pi OS (Bullseye/Bookworm)
#   - A domain pointing to your Pi's public IP (e.g. api.blackroad.io)
#   - Ports 80 and 443 forwarded to your Pi
# ═══════════════════════════════════════════════════════════════════

DOMAIN="${DOMAIN:-api.blackroad.io}"
APP_DIR="${APP_DIR:-/opt/blackroad-stripe}"
APP_USER="${APP_USER:-blackroad}"
NODE_VERSION="20"

echo "══════════════════════════════════════════════"
echo "  BlackRoad Stripe Server — Pi Setup"
echo "  Domain: ${DOMAIN}"
echo "  App Dir: ${APP_DIR}"
echo "══════════════════════════════════════════════"

# ── 1. System packages ────────────────────────────────────────────
echo "[1/7] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx git curl

# ── 2. Node.js via NodeSource ─────────────────────────────────────
echo "[2/7] Installing Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v${NODE_VERSION}* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v), npm: $(npm -v)"

# ── 3. App user & directory ───────────────────────────────────────
echo "[3/7] Creating app user and directory..."
if ! id "$APP_USER" &>/dev/null; then
  sudo useradd --system --create-home --shell /bin/bash "$APP_USER"
fi
sudo mkdir -p "$APP_DIR"
sudo chown "$APP_USER:$APP_USER" "$APP_DIR"

# ── 4. Deploy app ────────────────────────────────────────────────
echo "[4/7] Deploying application..."
sudo -u "$APP_USER" bash -c "
  cd '$APP_DIR'
  if [ -d .git ]; then
    git pull origin main
  else
    git clone https://github.com/blackboxprogramming/blackboxprogramming.github.io.git .
  fi
  npm ci --production
"

# ── 5. Env file ──────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  echo "[!] Creating .env template — YOU MUST edit this with your Stripe keys!"
  sudo -u "$APP_USER" cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "    Edit: sudo -u $APP_USER nano $APP_DIR/.env"
fi

# ── 6. Systemd service ──────────────────────────────────────────
echo "[5/7] Creating systemd service..."
sudo tee /etc/systemd/system/blackroad-stripe.service > /dev/null <<UNIT
[Unit]
Description=BlackRoad Stripe Payment Server
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=blackroad-stripe

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable blackroad-stripe
sudo systemctl restart blackroad-stripe
echo "  Service status: $(systemctl is-active blackroad-stripe)"

# ── 7. Nginx reverse proxy ──────────────────────────────────────
echo "[6/7] Configuring nginx reverse proxy..."
sudo tee /etc/nginx/sites-available/blackroad-stripe > /dev/null <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Redirect to HTTPS (certbot will handle this)
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    # SSL certs (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=stripe:10m rate=10r/s;

    location / {
        limit_req zone=stripe burst=20 nodelay;
        proxy_pass http://127.0.0.1:4242;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    # Stripe webhook needs higher body size limit
    location /webhook {
        limit_req zone=stripe burst=50 nodelay;
        proxy_pass http://127.0.0.1:4242/webhook;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 1m;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/blackroad-stripe /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# ── 8. SSL Certificate ──────────────────────────────────────────
echo "[7/7] Obtaining SSL certificate..."
echo "  Run: sudo certbot --nginx -d ${DOMAIN}"
echo "  (Skipping auto-run — requires interactive confirmation)"

echo ""
echo "══════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo "══════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Edit Stripe keys:  sudo -u ${APP_USER} nano ${APP_DIR}/.env"
echo "  2. Get SSL cert:      sudo certbot --nginx -d ${DOMAIN}"
echo "  3. Set up webhook:    https://dashboard.stripe.com/webhooks"
echo "     → Endpoint URL:    https://${DOMAIN}/webhook"
echo "     → Events:          checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed"
echo "  4. Check status:      sudo systemctl status blackroad-stripe"
echo "  5. View logs:         sudo journalctl -u blackroad-stripe -f"
echo ""
echo "Your Pi is now a Stripe payment server. 🎉"
