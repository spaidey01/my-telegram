#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
APP_DIR=/opt/my-telegram
APP_USER=telegram
ENV_FILE=/etc/my-telegram.env
BRANCH=main
TURN_MIN_PORT=49160
TURN_MAX_PORT=49200
BACKUP_DIR=/var/backups/stargram-runner
log(){ printf '\n==> %s\n' "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }
ask(){ local v; read -r -p "$1 [$2]: " v; printf '%s' "\${v:-$2}"; }
randhex(){ openssl rand -hex "$1"; }
[[ $EUID -eq 0 ]] || die "Run as root: sudo bash deploy/stargram-runner.sh"
command -v apt-get >/dev/null || die "Only Debian/Ubuntu supported."
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"

open_ports(){
  log "Opening required ports using the host firewall"
  local ssh_port=""
  [[ -n "\${SSH_CONNECTION:-}" ]] && ssh_port="$(awk '{print $4}' <<<"$SSH_CONNECTION")"
  if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
    [[ -n "$ssh_port" ]] && ufw allow "$ssh_port/tcp" >/dev/null
    ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 3478/tcp; ufw allow 3478/udp; ufw allow 5349/tcp
    ufw allow "$TURN_MIN_PORT:$TURN_MAX_PORT/udp"; ufw reload
  elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=http; firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-port=3478/tcp; firewall-cmd --permanent --add-port=3478/udp
    firewall-cmd --permanent --add-port=5349/tcp; firewall-cmd --permanent --add-port="$TURN_MIN_PORT-$TURN_MAX_PORT/udp"
    firewall-cmd --reload
  else
    apt-get install -y ufw
    [[ -n "$ssh_port" ]] && ufw allow "$ssh_port/tcp" >/dev/null
    ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 3478/tcp; ufw allow 3478/udp; ufw allow 5349/tcp
    ufw allow "$TURN_MIN_PORT:$TURN_MAX_PORT/udp"
    [[ -n "$ssh_port" ]] || ufw allow OpenSSH
    ufw --force enable
  fi
}
install_packages(){
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git build-essential nginx redis-server clamav clamav-daemon coturn openssl sudo ufw
  if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != 22 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || die "Node.js 22 required."
  command -v docker >/dev/null || apt-get install -y docker.io
  systemctl enable --now docker redis-server
}
checkout_app(){
  log "Preparing source without deleting local changes"
  if [[ -d "$APP_DIR/.git" ]]; then
    [[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || die "Local changes in $APP_DIR; refusing to overwrite."
    git -C "$APP_DIR" fetch origin "$BRANCH"
    [[ "$(git -C "$APP_DIR" branch --show-current)" == "$BRANCH" ]] || die "Checkout is not on $BRANCH."
    git -C "$APP_DIR" merge --ff-only "origin/$BRANCH"
  elif [[ -e "$APP_DIR" ]]; then die "$APP_DIR exists and is not a Git checkout."
  else git clone --branch "$BRANCH" --single-branch https://github.com/spaidey01/my-telegram.git "$APP_DIR"; fi
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
  chown -R "$APP_USER:$(id -gn "$APP_USER")" "$APP_DIR"
}
setup_auto_services(){
  local mongo_pw s3_user s3_pw turn_secret realm public_ip
  mongo_pw="$(randhex 24)"; s3_user="stargram$(randhex 8)"; s3_pw="$(randhex 32)"
  docker volume create stargram-mongodb-data >/dev/null
  docker volume create stargram-minio-data >/dev/null
  docker container inspect stargram-mongodb >/dev/null 2>&1 && die "Existing MongoDB container found; refusing to guess credentials."
  docker container inspect stargram-minio >/dev/null 2>&1 && die "Existing MinIO container found; refusing to guess credentials."
  docker run -d --name stargram-mongodb --restart unless-stopped -p 127.0.0.1:27017:27017 -e MONGO_INITDB_ROOT_USERNAME=stargram -e MONGO_INITDB_ROOT_PASSWORD="$mongo_pw" -e MONGO_INITDB_DATABASE=stargram -v stargram-mongodb-data:/data/db mongo:8 >/dev/null
  docker run -d --name stargram-minio --restart unless-stopped -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 -e MINIO_ROOT_USER="$s3_user" -e MINIO_ROOT_PASSWORD="$s3_pw" -v stargram-minio-data:/data quay.io/minio/minio:latest server /data --console-address ':9001' >/dev/null
  for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1 || die "MinIO did not become ready."
  docker run --rm --network host -e MC_HOST_stargram="http://$s3_user:$s3_pw@127.0.0.1:9000" quay.io/minio/mc:latest mb --ignore-existing stargram/stargram >/dev/null
  public_ip="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  realm="$(ask "TURN realm (public IP or hostname)" "$public_ip")"; turn_secret="$(randhex 32)"
  cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=$turn_secret
realm=$realm
server-name=$realm
listening-ip=0.0.0.0
external-ip=$public_ip
min-port=$TURN_MIN_PORT
max-port=$TURN_MAX_PORT
no-multicast-peers
no-cli
no-loopback-peers
stale-nonce
total-quota=100
EOF
  chmod 640 /etc/turnserver.conf
  if [[ -f /etc/default/coturn ]]; then
    grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn && sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
  fi
  systemctl enable --now coturn; systemctl restart coturn
  cat > /run/stargram-generated.env <<EOF
MONGODB_URI=mongodb://stargram:$mongo_pw@127.0.0.1:27017/stargram?authSource=admin
S3_ACCESS_KEY=$s3_user
S3_SECRET_KEY=$s3_pw
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET_NAME=stargram
TURN_URL=turn:$realm:3478?transport=udp,turn:$realm:3478?transport=tcp
TURN_SECRET=$turn_secret
TURN_CREDENTIAL_TTL_SECONDS=600
TURN_REALM=$realm
TURN_MIN_PORT=$TURN_MIN_PORT
TURN_MAX_PORT=$TURN_MAX_PORT
EOF
  chmod 600 /run/stargram-generated.env
}
setup_network(){
  local domain email ip url
  domain="$(ask "Domain (blank = IP/HTTP test mode)" "")"
  ip="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  if [[ -n "$domain" ]]; then
    [[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" == *.* ]] || die "Invalid domain."
    email="$(ask "Let's Encrypt email" "")"; [[ "$email" == *@*.* ]] || die "Valid email required."
    url="https://$domain"
  else
    url="http://$ip"
    echo "WARNING: public HTTP over IP normally blocks browser microphone/camera. HTTPS is needed for public calls."
  fi
  cat > /etc/nginx/sites-available/stargram <<EOF
server {
 listen 80 default_server;
 listen [::]:80 default_server;
 server_name \${domain:-_};
 client_max_body_size 30m;
 location /socket.io/ {
  proxy_pass http://127.0.0.1:3001/socket.io/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade \$http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host \$host;
  proxy_read_timeout 3600s;
 }
 location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
 }
}
EOF
  ln -sfn /etc/nginx/sites-available/stargram /etc/nginx/sites-enabled/stargram; rm -f /etc/nginx/sites-enabled/default
  nginx -t; systemctl enable --now nginx; systemctl reload nginx
  if [[ -n "$domain" ]]; then
    apt-get install -y certbot python3-certbot-nginx
    if ! certbot --nginx -d "$domain" --email "$email" --agree-tos --non-interactive --redirect; then
      echo "WARNING: certificate issuance failed (usually DNS or inbound port 80). Keeping HTTP test mode for now."
      url="http://$ip"
    fi
    systemctl enable --now certbot.timer || true
    if [[ -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
      printf '\ncert=/etc/letsencrypt/live/%s/fullchain.pem\npkey=/etc/letsencrypt/live/%s/privkey.pem\n' "$domain" "$domain" >> /etc/turnserver.conf
      systemctl restart coturn
    fi
  fi
  cat > /run/stargram-network.env <<EOF
CLIENT_ORIGIN=$url
NEXT_PUBLIC_APP_URL=$url
NEXT_PUBLIC_SOCKET_SERVER_URL=$url
TRUSTED_PROXY_COUNT=1
STARGRAM_ALLOW_HTTP=$([[ "$url" == http://* ]] && echo true || echo false)
EOF
}
write_manual_env(){
  local mongo redis s3 bucket access secret app socket turn turnsecret realm
  mongo="$(ask "MongoDB URI" "")"; redis="$(ask "Redis URL" "redis://127.0.0.1:6379")"
  s3="$(ask "S3 endpoint (HTTPS or local loopback HTTP)" "")"; bucket="$(ask "S3 bucket" "")
  access="$(ask "S3 access key" "")"; secret="$(ask "S3 secret key" "")
  app="$(ask "App URL" "")"; socket="$(ask "Socket URL" "$app")"; turn="$(ask "TURN URL(s)" "")
  turnsecret="$(ask "TURN secret (32+ chars)" "")"; realm="$(ask "TURN realm" "")
  [[ "$mongo" == mongodb://* || "$mongo" == mongodb+srv://* ]] || die "Invalid MongoDB URI."
  [[ "$s3" == https://* || "$s3" == http://127.0.0.1:* ]] || die "S3 must use HTTPS or loopback HTTP."
  [[ -n "$bucket" && -n "$access" && -n "$secret" && -n "$turn" && \${#turnsecret} -ge 32 && -n "$realm" ]] || die "Missing required values."
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
secretKey=$(randhex 32)
MONGODB_URI=$mongo
REDIS_URL=$redis
S3_ENDPOINT=$s3
S3_BUCKET_NAME=$bucket
S3_ACCESS_KEY=$access
S3_SECRET_KEY=$secret
$(cat /run/stargram-network.env)
TURN_URL=$turn
TURN_SECRET=$turnsecret
TURN_CREDENTIAL_TTL_SECONDS=600
TURN_REALM=$realm
TURN_MIN_PORT=$TURN_MIN_PORT
TURN_MAX_PORT=$TURN_MAX_PORT
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
TRUSTED_PROXY_COUNT=1
STARGRAM_ALLOW_HTTP=$([[ "$app" == http://* ]] && echo true || echo false)
EOF
}
apply_config(){
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE."
  cp -a "$ENV_FILE" "$BACKUP_DIR/my-telegram.env.$(date +%Y%m%d%H%M%S).bak"
  chown "$APP_USER:$(id -gn "$APP_USER")" "$ENV_FILE"; chmod 0640 "$ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
  [[ \${#secretKey} -ge 32 && \${#TURN_SECRET} -ge 32 ]] || die "Secrets missing or too short."
  sudo -u "$APP_USER" env $(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/[[:space:]]*#.*$//') NODE_ENV=production node "$APP_DIR/scripts/validate-production-env.mjs"
  install -m 0644 "$APP_DIR/deploy/my-telegram-web.service" /etc/systemd/system/my-telegram-web.service
  install -m 0644 "$APP_DIR/deploy/my-telegram-socket.service" /etc/systemd/system/my-telegram-socket.service
  systemctl daemon-reload; systemctl enable --now redis-server
  systemctl enable clamav-daemon || true; systemctl restart clamav-daemon || true
  cd "$APP_DIR"; sudo -u "$APP_USER" npm ci
  sudo -u "$APP_USER" env $(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/[[:space:]]*#.*$//') NODE_ENV=production npm run build
  systemctl enable --now my-telegram-web my-telegram-socket; systemctl restart my-telegram-web my-telegram-socket
  sleep 3
  systemctl is-active --quiet my-telegram-web || die "Web service failed; check journalctl."
  systemctl is-active --quiet my-telegram-socket || die "Socket service failed; check journalctl."
  curl -fsS http://127.0.0.1:3000 >/dev/null || die "Local web health check failed."
  rm -f /run/stargram-generated.env /run/stargram-network.env
  log "Services are active. Perform a real two-browser call test."
}
echo "Stargram Setup Runner"
echo "1) Automatic install (local MongoDB, MinIO/S3, Redis, Coturn, ClamAV)"
echo "2) Manual service credentials; remaining dependencies install automatically"
echo "3) Network / domain / HTTPS setup or update"
echo "4) Edit configuration after install"
echo "5) Validate/build/restart current configuration"
echo "0) Exit"
choice="$(ask "Choose" "1")"
case "$choice" in
  1) [[ ! -f "$ENV_FILE" ]] || die "Configuration already exists. Choose option 4 to revalidate/rebuild or option 3 to edit it."
     install_packages; checkout_app; open_ports; setup_auto_services; setup_network
     cat > "$ENV_FILE" <<EOF
NODE_ENV=production
secretKey=$(randhex 32)
$(cat /run/stargram-generated.env)
REDIS_URL=redis://127.0.0.1:6379
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
$(cat /run/stargram-network.env)
EOF
     apply_config ;;
  2) install_packages; checkout_app; open_ports; write_manual_env; apply_config ;;
  3) [[ -f "$ENV_FILE" ]] || die "No configuration exists yet."; cp -a "$ENV_FILE" "$BACKUP_DIR/my-telegram.env.$(date +%Y%m%d%H%M%S).bak"; "\${EDITOR:-nano}" "$ENV_FILE" ;;
  4) install_packages; checkout_app; apply_config ;;
  0) exit 0 ;;
  *) die "Invalid option." ;;
esac
