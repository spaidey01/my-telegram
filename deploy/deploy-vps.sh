#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/my-telegram}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-/etc/my-telegram.env}"
APP_USER="${APP_USER:-telegram}"

log() { printf '\n==> %s\n' "$1"; }
die() { echo "ERROR: $1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this script as root (sudo)."
[[ -d "$APP_DIR/.git" ]] || die "Stargram is not installed at $APP_DIR."

log "Updating source"
git -C "$APP_DIR" fetch origin "$BRANCH"
git -C "$APP_DIR" checkout "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/$BRANCH"

log "Installing dependencies"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci

log "Validating production environment"
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
sudo -u "$APP_USER" env NODE_ENV=production node "$APP_DIR/scripts/validate-production-env.mjs"

log "Building"
sudo -u "$APP_USER" npm run build

log "Restarting Stargram"
systemctl daemon-reload
systemctl restart my-telegram-web my-telegram-socket

log "Health"
systemctl --no-pager --full status my-telegram-web my-telegram-socket
