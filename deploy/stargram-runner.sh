#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
APP_DIR=/opt/my-telegram
APP_USER=telegram
ENV_FILE=/etc/my-telegram.env
BRANCH="${BRANCH:-stargram_clone}"
REPO_URL="${REPO_URL:-https://github.com/spaidey01/my-telegram.git}"
MONGO_IMAGE="${MONGO_IMAGE:-mongo:8.0.12}"
SEAWEEDFS_IMAGE="${SEAWEEDFS_IMAGE:-chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d}"

TURN_MIN_PORT=49160
TURN_MAX_PORT=49200
BACKUP_DIR=/var/backups/stargram-runner
# Initialize values read from the protected env file so `set -u` reports
# missing secrets through the explicit validation below, not an unbound-variable crash.
secretKey=""
TURN_SECRET=""
S3_ENDPOINT_VALUE=""
log(){ printf '\n==> %s\n' "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }
ask(){ local v; read -r -p "$1 [$2]: " v; printf '%s' "${v:-$2}"; }
randhex(){ openssl rand -hex "$1"; }
public_ipv4(){
  local candidate octet_a octet_b octet_c octet_d octet
  candidate="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [[ ! "$candidate" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    candidate="$(curl -4fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
  fi
  [[ "$candidate" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "Could not determine the public IPv4 address. Check outbound network access and rerun."
  IFS=. read -r octet_a octet_b octet_c octet_d <<< "$candidate"
  for octet in "$octet_a" "$octet_b" "$octet_c" "$octet_d"; do
    [[ "$octet" =~ ^[0-9]{1,3}$ ]] && (( 10#$octet <= 255 )) || die "Public IPv4 lookup returned an invalid address."
  done
  # Reject special-use, private, documentation, benchmarking, multicast and reserved ranges.
  (( 10#$octet_a != 0 && 10#$octet_a != 10 && 10#$octet_a != 127 && 10#$octet_a < 224 )) || die "Public IPv4 lookup returned a non-public address: $candidate"
  ! (( 10#$octet_a == 169 && 10#$octet_b == 254 )) || die "Public IPv4 lookup returned a link-local address: $candidate"
  ! (( 10#$octet_a == 172 && 10#$octet_b >= 16 && 10#$octet_b <= 31 )) || die "Public IPv4 lookup returned a private address: $candidate"
  ! (( 10#$octet_a == 192 && 10#$octet_b == 168 )) || die "Public IPv4 lookup returned a private address: $candidate"
  ! (( 10#$octet_a == 100 && 10#$octet_b >= 64 && 10#$octet_b <= 127 )) || die "Public IPv4 lookup returned a carrier-grade NAT address: $candidate"
  ! (( 10#$octet_a == 192 && 10#$octet_b == 0 && 10#$octet_c == 0 )) || die "Public IPv4 lookup returned a special-use address: $candidate"
  ! (( 10#$octet_a == 192 && 10#$octet_b == 0 && 10#$octet_c == 2 )) || die "Public IPv4 lookup returned a documentation address: $candidate"
  ! (( 10#$octet_a == 192 && 10#$octet_b == 88 && 10#$octet_c == 99 )) || die "Public IPv4 lookup returned a deprecated relay address: $candidate"
  ! (( 10#$octet_a == 198 && (10#$octet_b == 18 || 10#$octet_b == 19) )) || die "Public IPv4 lookup returned a benchmarking address: $candidate"
  ! (( 10#$octet_a == 198 && 10#$octet_b == 51 && 10#$octet_c == 100 )) || die "Public IPv4 lookup returned a documentation address: $candidate"
  ! (( 10#$octet_a == 203 && 10#$octet_b == 0 && 10#$octet_c == 113 )) || die "Public IPv4 lookup returned a documentation address: $candidate"
  (( 10#$octet_a != 192 || 10#$octet_b != 31 || 10#$octet_c != 196 )) || die "Public IPv4 lookup returned a special-use address: $candidate"
  (( 10#$octet_a < 240 )) || die "Public IPv4 lookup returned a reserved address: $candidate"
  printf '%s' "$candidate"
}
[[ $EUID -eq 0 ]] || die "Run as root: sudo bash deploy/stargram-runner.sh"
command -v apt-get >/dev/null || die "Only Debian/Ubuntu supported."
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"

open_ports(){
  log "Opening required ports using the host firewall"
  local ssh_port=""
  [[ -n "${SSH_CONNECTION:-}" ]] && ssh_port="$(awk '{print $4}' <<<"$SSH_CONNECTION")"
  [[ -n "$ssh_port" ]] || ssh_port=22
  if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
    [[ -n "$ssh_port" ]] && ufw allow "$ssh_port/tcp" >/dev/null
    ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 3478/tcp; ufw allow 3478/udp; ufw allow 5349/tcp
    ufw allow "$TURN_MIN_PORT:$TURN_MAX_PORT/udp"; ufw reload
  elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    # Preserve the active SSH path before enabling the application ports.
    firewall-cmd --permanent --add-port="${ssh_port}/tcp"
    firewall-cmd --permanent --add-service=http; firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-port=3478/tcp; firewall-cmd --permanent --add-port=3478/udp
    firewall-cmd --permanent --add-port=5349/tcp; firewall-cmd --permanent --add-port="$TURN_MIN_PORT-$TURN_MAX_PORT/udp"
    firewall-cmd --reload
  else
    apt-get install -y ufw
    [[ -n "$ssh_port" ]] && ufw allow "$ssh_port/tcp" >/dev/null
    ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 3478/tcp; ufw allow 3478/udp; ufw allow 5349/tcp
    ufw allow "$TURN_MIN_PORT:$TURN_MAX_PORT/udp"
    [[ -n "$ssh_port" ]] || ufw allow 22/tcp
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
  docker info >/dev/null 2>&1 || die "Docker daemon is unavailable."
}
checkout_app(){
  log "Preparing source without deleting local changes"
  if [[ -d "$APP_DIR/.git" ]]; then
    [[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || die "Local changes in $APP_DIR; refusing to overwrite."
    git -C "$APP_DIR" fetch origin "$BRANCH"
    if ! git -C "$APP_DIR" checkout "$BRANCH"; then
      git -C "$APP_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
    fi
    git -C "$APP_DIR" merge --ff-only "origin/$BRANCH"
  elif [[ -e "$APP_DIR" ]]; then die "$APP_DIR exists and is not a Git checkout."
  else git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$APP_DIR"; fi
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
  local app_group
  app_group="$(id -gn "$APP_USER")"
  # Keep the checkout metadata and repository root out of the runtime user's control.
  # The runner later executes Git as root; a writable .git/hooks directory would
  # let the app user plant hooks that execute during privileged checkout/merge.
  # Keep checked-out source and Git metadata root-owned; only build output is writable.
  chown -R root:root "$APP_DIR"
  chmod -R go-w "$APP_DIR/.git"
  install -d -o "$APP_USER" -g "$app_group" -m 0750 "$APP_DIR/node_modules" "$APP_DIR/.next"
}
setup_auto_services(){
  local mongo_pw s3_user s3_pw turn_secret realm public_ip
  # Resolve public network prerequisites before creating persistent resources.
  public_ip="$(public_ipv4)"
  realm="$(ask "TURN realm (public IP or hostname)" "$public_ip")"
  turn_secret="$(randhex 32)"
  mongo_pw="$(randhex 24)"; s3_user="stargram$(randhex 8)"; s3_pw="$(randhex 32)"
  # Refuse to adopt existing services before creating any persistent resources.
  docker container inspect stargram-mongodb >/dev/null 2>&1 && die "Existing MongoDB container found; refusing to guess credentials."
  docker container inspect stargram-minio >/dev/null 2>&1 && die "Legacy MinIO container found; refusing to adopt it."
  docker container inspect stargram-seaweedfs >/dev/null 2>&1 && die "Existing SeaweedFS container found; refusing to guess credentials."
  docker volume inspect stargram-mongodb-data >/dev/null 2>&1 && die "Existing MongoDB volume found; refusing to reuse unknown data."
  docker volume inspect stargram-seaweedfs-data >/dev/null 2>&1 && die "Existing SeaweedFS volume found; refusing to reuse unknown data."
  # Pull all required images before creating persistent resources, so registry failures
  # cannot leave a half-installed database behind.
  docker pull "$MONGO_IMAGE"
  docker pull "$SEAWEEDFS_IMAGE"
  # Legacy stargram-minio-data is deliberately left untouched and is not reused.
  docker volume create stargram-mongodb-data >/dev/null
  docker volume create stargram-seaweedfs-data >/dev/null
  docker run -d --name stargram-mongodb --restart unless-stopped -p 127.0.0.1:27017:27017 -e MONGO_INITDB_ROOT_USERNAME=stargram -e MONGO_INITDB_ROOT_PASSWORD="$mongo_pw" -e MONGO_INITDB_DATABASE=stargram -v stargram-mongodb-data:/data/db "$MONGO_IMAGE" >/dev/null
  docker run -d --name stargram-seaweedfs --restart unless-stopped -p 127.0.0.1:8333:8333 -v stargram-seaweedfs-data:/data -e AWS_ACCESS_KEY_ID="$s3_user" -e AWS_SECRET_ACCESS_KEY="$s3_pw" -e S3_BUCKET=stargram "$SEAWEEDFS_IMAGE" mini -dir=/data >/dev/null
  for _ in $(seq 1 60); do docker exec stargram-mongodb mongosh --quiet --username stargram --password "$mongo_pw" --authenticationDatabase admin --eval 'db.adminCommand({ping: 1}).ok' >/dev/null 2>&1 && break; sleep 2; done
  docker exec stargram-mongodb mongosh --quiet --username stargram --password "$mongo_pw" --authenticationDatabase admin --eval 'db.adminCommand({ping: 1}).ok' >/dev/null 2>&1 || die "MongoDB did not become ready."
  local s3_http_code=""
  for _ in $(seq 1 60); do
    s3_http_code="$(curl -sS -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:8333/ 2>/dev/null || true)"
    [[ "$s3_http_code" =~ ^[234][0-9][0-9]$ ]] && break
    sleep 2
  done
  [[ "$s3_http_code" =~ ^[234][0-9][0-9]$ ]] || { docker logs --tail 60 stargram-seaweedfs >&2 || true; die "SeaweedFS S3 endpoint did not become ready on 127.0.0.1:8333."; }
  if [[ -f /etc/turnserver.conf ]]; then cp -a /etc/turnserver.conf "$BACKUP_DIR/turnserver.conf.$(date +%Y%m%d%H%M%S).bak"; fi
  cat > /etc/turnserver.conf <<EOF
listening-port=3478
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
S3_ENDPOINT=http://127.0.0.1:8333
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
  local domain email ip url nginx_backup="" default_backup=""
  domain="$(ask "Domain (blank = IP/HTTP test mode)" "")"
  ip="$(public_ipv4)"
  if [[ -n "$domain" ]]; then
    [[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" == *.* ]] || die "Invalid domain."
    email="$(ask "Let's Encrypt email" "")"; [[ "$email" == *@*.* ]] || die "Valid email required."
    url="https://$domain"
  else
    url="http://$ip"
    echo "WARNING: public HTTP over IP normally blocks browser microphone/camera. HTTPS is needed for public calls."
  fi
  # Browser uploads use path-style presigned URLs (/stargram/<key>), which Nginx
  # forwards to SeaweedFS. Keep the public endpoint in app config, but only rewrite
  # it for the managed local SeaweedFS deployment; never overwrite a manual S3 URL.
  if [[ -f /run/stargram-generated.env ]]; then
    sed -i "s|^S3_ENDPOINT=.*|S3_ENDPOINT=$url|" /run/stargram-generated.env
  fi
  if [[ -e /etc/nginx/sites-available/stargram ]]; then
    nginx_backup="$BACKUP_DIR/nginx-stargram.$(date +%Y%m%d%H%M%S).bak"
    cp -a /etc/nginx/sites-available/stargram "$nginx_backup"
  fi
  if [[ -L /etc/nginx/sites-enabled/default || -e /etc/nginx/sites-enabled/default ]]; then
    default_backup="$BACKUP_DIR/nginx-default-enabled.$(date +%Y%m%d%H%M%S).bak"
    cp -a /etc/nginx/sites-enabled/default "$default_backup"
    rm -f /etc/nginx/sites-enabled/default
  fi
  cat > /etc/nginx/sites-available/stargram <<EOF
server {
 listen 80 default_server;
 listen [::]:80 default_server;
 server_name ${domain:-_};
 client_max_body_size 30m;
 location ^~ /stargram {
  proxy_pass http://127.0.0.1:8333;
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_request_buffering off;
  proxy_buffering off;
  proxy_read_timeout 300s;
 }
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
  if ! nginx -t; then
    log "New Nginx configuration is invalid; restoring the previous site configuration"
    if [[ -n "$nginx_backup" && -f "$nginx_backup" ]]; then
      cp -a "$nginx_backup" /etc/nginx/sites-available/stargram
      ln -sfn /etc/nginx/sites-available/stargram /etc/nginx/sites-enabled/stargram
    else
      rm -f /etc/nginx/sites-enabled/stargram /etc/nginx/sites-available/stargram
    fi
    if [[ -n "$default_backup" && -e "$default_backup" ]]; then
      cp -a "$default_backup" /etc/nginx/sites-enabled/default
    fi
    nginx -t && systemctl reload nginx || true
    die "Nginx configuration validation failed; previous configuration was restored."
  fi
  if ! systemctl enable --now nginx || ! systemctl reload nginx; then
    log "Nginx failed to start or reload; restoring the previous site configuration"
    if [[ -n "$nginx_backup" && -f "$nginx_backup" ]]; then
      cp -a "$nginx_backup" /etc/nginx/sites-available/stargram
      ln -sfn /etc/nginx/sites-available/stargram /etc/nginx/sites-enabled/stargram
    else
      rm -f /etc/nginx/sites-enabled/stargram /etc/nginx/sites-available/stargram
    fi
    if [[ -n "$default_backup" && -e "$default_backup" ]]; then
      cp -a "$default_backup" /etc/nginx/sites-enabled/default
    fi
    if nginx -t; then systemctl reload nginx || true; fi
    die "Nginx failed to start or reload; previous site configuration was restored."
  fi
  if [[ -n "$domain" ]]; then
    apt-get install -y certbot python3-certbot-nginx
    if ! certbot --nginx -d "$domain" --email "$email" --agree-tos --non-interactive --redirect; then
      log "Certificate issuance failed; restoring the previous Nginx site configuration"
      if [[ -n "$nginx_backup" && -f "$nginx_backup" ]]; then
        cp -a "$nginx_backup" /etc/nginx/sites-available/stargram
        ln -sfn /etc/nginx/sites-available/stargram /etc/nginx/sites-enabled/stargram
      else
        rm -f /etc/nginx/sites-enabled/stargram /etc/nginx/sites-available/stargram
      fi
      if [[ -n "$default_backup" && -e "$default_backup" ]]; then
        cp -a "$default_backup" /etc/nginx/sites-enabled/default
      fi
      if nginx -t; then systemctl reload nginx || true; fi
      die "HTTPS certificate issuance failed. Previous Nginx configuration was restored; fix DNS/firewall and rerun option 3."
    fi
    systemctl enable --now certbot.timer || true
    if [[ -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
      sed -i '/^cert=/d;/^pkey=/d;/^tls-listening-port=/d' /etc/turnserver.conf
      printf '\ntls-listening-port=5349\ncert=/etc/letsencrypt/live/%s/fullchain.pem\npkey=/etc/letsencrypt/live/%s/privkey.pem\n' "$domain" "$domain" >> /etc/turnserver.conf
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
  local mongo redis s3 bucket access secret turn turnsecret realm
  mongo="$(ask "MongoDB URI" "")"; redis="$(ask "Redis URL" "redis://127.0.0.1:6379")"
  s3="$(ask "S3 endpoint (HTTPS or local loopback HTTP)" "")"; bucket="$(ask "S3 bucket" "")"
  access="$(ask "S3 access key" "")"; secret="$(ask "S3 secret key" "")"
  turn="$(ask "TURN URL(s)" "")"; turnsecret="$(ask "TURN secret (32+ chars)" "")"; realm="$(ask "TURN realm" "")"

  [[ "$mongo" == mongodb://* || "$mongo" == mongodb+srv://* ]] || die "Invalid MongoDB URI."
  [[ "$s3" == https://* || "$s3" == http://127.0.0.1:* ]] || die "S3 must use HTTPS or loopback HTTP."
  [[ -n "$bucket" && -n "$access" && -n "$secret" && -n "$turn" && ${#turnsecret} -ge 32 && -n "$realm" ]] || die "Missing required values."
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
EOF
}
configure_clamav(){
  log "Configuring and verifying fail-closed ClamAV scanner"
  local conf=/etc/clamav/clamd.conf
  [[ -f "$conf" ]] || die "ClamAV daemon configuration is missing."
  # The application talks to clamd over loopback TCP; Debian defaults to a Unix socket.
  if grep -qE '^[[:space:]]*TCPSocket[[:space:]]+' "$conf"; then
    sed -i -E 's/^[[:space:]]*TCPSocket[[:space:]]+.*/TCPSocket 3310/' "$conf"
  else
    printf '\nTCPSocket 3310\n' >> "$conf"
  fi
  if grep -qE '^[[:space:]]*TCPAddr[[:space:]]+' "$conf"; then
    sed -i -E 's/^[[:space:]]*TCPAddr[[:space:]]+.*/TCPAddr 127.0.0.1/' "$conf"
  else
    printf 'TCPAddr 127.0.0.1\n' >> "$conf"
  fi
  # Try to refresh signatures once. A network/CDN failure is acceptable only when
  # a usable, non-empty signature database is already installed.
  if command -v freshclam >/dev/null 2>&1; then
    systemctl stop clamav-freshclam >/dev/null 2>&1 || true
    timeout 180 freshclam --stdout --verbose || log "FreshClam update failed; checking whether existing signatures are usable"
    systemctl enable --now clamav-freshclam || log "Could not start the FreshClam updater; scanner startup will still be validated"
  fi
  local version
  version="$(clamscan --version 2>/dev/null || true)"
  [[ "$version" =~ ClamAV[[:space:]].*/[1-9][0-9]*/ ]] || die "ClamAV signature database is missing or unusable. Fix FreshClam/network access before continuing."
  systemctl enable clamav-daemon >/dev/null
  systemctl restart clamav-daemon
  local reply=""
  for _ in $(seq 1 30); do
    reply="$( (exec 3<>/dev/tcp/127.0.0.1/3310 && printf 'PING\n' >&3 && IFS= read -r -t 2 reply <&3 && printf '%s' "$reply") 2>/dev/null || true)"
    [[ "$reply" == "PONG" ]] && break
    sleep 2
  done
  [[ "$reply" == "PONG" ]] || die "ClamAV clamd did not answer PING on 127.0.0.1:3310; refusing to start Stargram without scanning."
}
load_env_file(){
  local line key value
  local -A seen_keys=()
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE."
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \\#* ]] && continue
    [[ "$line" == *=* ]] || die "Invalid environment line (expected KEY=VALUE)."
    key="${line%%=*}"; value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid environment key: $key"
    [[ -z "${seen_keys[$key]+x}" ]] || die "Duplicate environment key: $key"
    seen_keys["$key"]=1
    # Never source the env file into the privileged runner shell.
    case "$key" in
      secretKey) printf -v secretKey '%s' "$value" ;;
      TURN_SECRET) printf -v TURN_SECRET '%s' "$value" ;;
    esac
  done < "$ENV_FILE"
}
build_env_args(){
  ENV_ARGS=()
  local line key value
  local -A seen_keys=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \\#* ]] && continue
    [[ "$line" == *=* ]] || die "Invalid environment line (expected KEY=VALUE)."
    key="${line%%=*}"; value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid environment key: $key"
    [[ -z "${seen_keys[$key]+x}" ]] || die "Duplicate environment key: $key"
    seen_keys["$key"]=1
    [[ "$key" == "S3_ENDPOINT" ]] && S3_ENDPOINT_VALUE="$value"
    ENV_ARGS+=("$key=$value")
  done < "$ENV_FILE"
}
verify_s3_storage(){
  log "Verifying authenticated S3 bucket with a real upload/download/delete cycle"
  cd "$APP_DIR"
  local S3_HEALTH_ENDPOINT="${S3_ENDPOINT_VALUE:-}"
  if docker container inspect stargram-seaweedfs >/dev/null 2>&1; then S3_HEALTH_ENDPOINT=http://127.0.0.1:8333; fi
  if ! sudo -u "$APP_USER" env "${ENV_ARGS[@]}" S3_ENDPOINT="$S3_HEALTH_ENDPOINT" node --input-type=module <<'NODE'
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET_NAME;
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.AWS_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const key = `.stargram-healthcheck-${randomUUID()}.txt`;
const body = `stargram-s3-healthcheck-${randomUUID()}`;
try {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (await downloaded.Body.transformToString() !== body) throw new Error("S3 round-trip content mismatch");
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log("S3 authenticated round-trip passed.");
} catch (error) {
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); } catch {}
  console.error("S3 authenticated health check failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { client.destroy(); }
NODE
  then
    die "S3 storage failed authenticated upload/download verification."
  fi
}
apply_config(){
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE."
  chown "root:$(id -gn "$APP_USER")" "$ENV_FILE"; chmod 0640 "$ENV_FILE"
  load_env_file
  # secretKey is populated by load_env_file via printf -v.
  # shellcheck disable=SC2154
  [[ ${#secretKey} -ge 32 && ${#TURN_SECRET} -ge 32 ]] || die "Secrets missing or too short."
  build_env_args
  sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production node "$APP_DIR/scripts/validate-production-env.mjs"
  install -m 0644 "$APP_DIR/deploy/my-telegram-web.service" /etc/systemd/system/my-telegram-web.service
  install -m 0644 "$APP_DIR/deploy/my-telegram-socket.service" /etc/systemd/system/my-telegram-socket.service
  systemctl daemon-reload; systemctl enable --now redis-server
  configure_clamav
  cd "$APP_DIR"; sudo -u "$APP_USER" npm ci --include=dev
  verify_s3_storage
  sudo -u "$APP_USER" env "${ENV_ARGS[@]}" NODE_ENV=production npm run build
  log "Removing development-only dependencies from the production server"
  sudo -u "$APP_USER" npm prune --omit=dev
  systemctl enable --now my-telegram-web my-telegram-socket; systemctl restart my-telegram-web my-telegram-socket
  sleep 3
  systemctl is-active --quiet my-telegram-web || die "Web service failed; check journalctl."
  systemctl is-active --quiet my-telegram-socket || die "Socket service failed; check journalctl."
  curl -fsS http://127.0.0.1:3000 >/dev/null || die "Local web health check failed."
  rm -f /run/stargram-generated.env /run/stargram-network.env
  log "Services are active. Perform a real two-browser call test."
}
echo "Stargram Setup Runner"
echo "Target branch: $BRANCH"
echo "Mongo image: $MONGO_IMAGE"
echo "SeaweedFS image: $SEAWEEDFS_IMAGE"
echo "WARNING: run first on a disposable Debian/Ubuntu VPS, not a production host."
echo "1) Automatic install (local MongoDB, SeaweedFS S3, Redis, Coturn, ClamAV)"
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
  2) [[ ! -f "$ENV_FILE" ]] || die "Configuration already exists. Choose option 4 to edit it or option 5 to validate/rebuild."
     install_packages; checkout_app; open_ports; setup_network; write_manual_env; apply_config ;;
  3) [[ -f "$ENV_FILE" ]] || die "No configuration exists yet."
     install_packages; open_ports; setup_network
     cp -a "$ENV_FILE" "$BACKUP_DIR/my-telegram.env.$(date +%Y%m%d%H%M%S).bak"
     if docker container inspect stargram-seaweedfs >/dev/null 2>&1; then
       s3_public_endpoint="$(sed -n 's/^CLIENT_ORIGIN=//p' /run/stargram-network.env)"
       [[ -n "$s3_public_endpoint" ]] || die "Could not determine public S3 endpoint."
       sed -i "s|^S3_ENDPOINT=.*|S3_ENDPOINT=$s3_public_endpoint|" "$ENV_FILE"
     fi
     sed -i '/^CLIENT_ORIGIN=/d;/^NEXT_PUBLIC_APP_URL=/d;/^NEXT_PUBLIC_SOCKET_SERVER_URL=/d;/^TRUSTED_PROXY_COUNT=/d;/^STARGRAM_ALLOW_HTTP=/d' "$ENV_FILE"
     cat /run/stargram-network.env >> "$ENV_FILE"
     chown "root:$(id -gn "$APP_USER")" "$ENV_FILE"; chmod 0640 "$ENV_FILE"
     apply_config ;;
  4) [[ -f "$ENV_FILE" ]] || die "No configuration exists yet."
     cp -a "$ENV_FILE" "$BACKUP_DIR/my-telegram.env.$(date +%Y%m%d%H%M%S).bak"
     "${EDITOR:-nano}" "$ENV_FILE"; apply_config ;;
  5) install_packages; checkout_app; apply_config ;;
  0) exit 0 ;;
  *) die "Invalid option." ;;
esac
