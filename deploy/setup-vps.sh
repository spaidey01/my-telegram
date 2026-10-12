#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/my-telegram}"
APP_USER="${APP_USER:-telegram}"
APP_GROUP="${APP_GROUP:-telegram}"
ENV_FILE="${ENV_FILE:-/etc/my-telegram.env}"
REPO_URL="${REPO_URL:-https://github.com/spaidey01/my-telegram.git}"
BRANCH="${BRANCH:-stargram_clone}"

log() { printf '\n==> %s\n' "$1"; }
die() { echo "ERROR: $1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this script as root (sudo)."

if command -v apt-get >/dev/null 2>&1; then
  log "Installing base packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git build-essential nginx redis-server clamav clamav-daemon coturn sudo
else
  die "This installer currently supports Debian/Ubuntu VPS only."
fi

log "Installing Node.js 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == "22" ]] || die "Node.js 22 is required; detected $(node -v)."

log "Creating application user"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi
APP_GROUP="$(id -gn "$APP_USER")"

log "Installing Stargram"
if [[ -d "$APP_DIR/.git" ]]; then
  [[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || die "Local changes in $APP_DIR; refusing to overwrite."
  git -C "$APP_DIR" fetch origin "$BRANCH"
  if ! git -C "$APP_DIR" checkout "$BRANCH"; then
    git -C "$APP_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
  fi
  git -C "$APP_DIR" merge --ff-only "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

log "Installing dependencies and building"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production npm run build

log "Installing systemd units"
install -m 0644 "$APP_DIR/deploy/my-telegram-web.service" /etc/systemd/system/my-telegram-web.service
install -m 0644 "$APP_DIR/deploy/my-telegram-socket.service" /etc/systemd/system/my-telegram-socket.service

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0640 -o "$APP_USER" -g "$APP_GROUP" "$APP_DIR/.env.example" "$ENV_FILE"
  echo
  echo "Created $ENV_FILE from .env.example."
  echo "Edit it with production secrets before starting Stargram."
fi

systemctl daemon-reload
systemctl enable my-telegram-web my-telegram-socket redis-server
systemctl restart redis-server

if [[ -f /etc/clamav/clamd.conf ]]; then
  systemctl enable clamav-daemon || true
  systemctl restart clamav-daemon || true
fi

log "Checking configuration"
if ! grep -q '^secretKey=' "$ENV_FILE" || grep -q '^secretKey=replace-with' "$ENV_FILE"; then
  echo "WARNING: configure $ENV_FILE before starting Stargram."
else
  ENV_ARGS=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \\#* ]] && continue
    [[ "$line" == *=* ]] || die "Invalid environment line in $ENV_FILE."
    key="${line%%=*}"; value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid environment key in $ENV_FILE."
    ENV_ARGS+=("$key=$value")
  done < "$ENV_FILE"
  sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production node "$APP_DIR/scripts/validate-production-env.mjs"
  sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production npm run build
  systemctl restart my-telegram-web my-telegram-socket
fi

log "VPS setup complete"
echo "App: $APP_DIR"
echo "Env: $ENV_FILE"
echo "Web service: my-telegram-web"
echo "Socket service: my-telegram-socket"
