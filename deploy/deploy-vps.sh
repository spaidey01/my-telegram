#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/my-telegram}"
BRANCH="${BRANCH:-stargram_clone}"
ENV_FILE="${ENV_FILE:-/etc/my-telegram.env}"
APP_USER="${APP_USER:-telegram}"

log() { printf '\n==> %s\n' "$1"; }
die() { echo "ERROR: $1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this script as root (sudo)."
[[ -d "$APP_DIR/.git" ]] || die "Stargram is not installed at $APP_DIR."

log "Updating source"
[[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || die "Local changes in $APP_DIR; refusing to overwrite."
git -C "$APP_DIR" fetch origin "$BRANCH"
if ! git -C "$APP_DIR" checkout "$BRANCH"; then
  git -C "$APP_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
fi
git -C "$APP_DIR" merge --ff-only "origin/$BRANCH"

log "Installing dependencies"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci

log "Validating production environment"
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE"
ENV_ARGS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == *=* ]] || die "Invalid environment line in $ENV_FILE."
  key="${line%%=*}"; value="${line#*=}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid environment key in $ENV_FILE."
  ENV_ARGS+=("$key=$value")
done < "$ENV_FILE"
sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production node "$APP_DIR/scripts/validate-production-env.mjs"

log "Building"
sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production npm run build

log "Restarting Stargram"
systemctl daemon-reload
systemctl restart my-telegram-web my-telegram-socket

log "Health"
systemctl --no-pager --full status my-telegram-web my-telegram-socket
