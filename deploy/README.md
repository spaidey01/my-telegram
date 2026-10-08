# VPS deployment

The application runs as two Node processes:

- Next.js web/API: port 3000
- Socket.IO: port 3001

Put production environment variables in `/etc/my-telegram.env` and keep that file outside the repository.

## Required production variables

```dotenv
NODE_ENV=production
secretKey=<long-random-secret>
MONGODB_URI=<mongodb-uri>
CLIENT_ORIGIN=https://chat.example.com
NEXT_PUBLIC_APP_URL=https://chat.example.com
NEXT_PUBLIC_SOCKET_SERVER_URL=https://chat.example.com
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret>
S3_ENDPOINT=<s3-endpoint>
S3_BUCKET_NAME=<bucket>
REDIS_URL=redis://127.0.0.1:6379
TRUSTED_PROXY_COUNT=1
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_REQUIRED=true
TURN_URL=turn:turn.example.com:3478,turns:turn.example.com:5349?transport=tcp
TURN_SECRET=<long-random-turn-secret>
TURN_CREDENTIAL_TTL_SECONDS=600
TURN_REALM=turn.example.com
TURN_MIN_PORT=49160
TURN_MAX_PORT=49200
SOCKET_PORT=3001
```

If Socket.IO uses a separate public hostname, set `NEXT_PUBLIC_SOCKET_SERVER_URL` and `CLIENT_ORIGIN` to the actual browser-facing origins. If a reverse proxy terminates TLS, set `TRUSTED_PROXY_COUNT` to the number of trusted proxies in front of Next.js.

## First deployment

```bash
git clone https://github.com/spaidey01/my-telegram.git /opt/my-telegram
cd /opt/my-telegram
npm ci
npm run build
```

Create `/etc/my-telegram.env`. Then, after taking a MongoDB backup, run the legacy-data cleanup once if old `Room.messages` fields still exist:

```bash
npm run db:cleanup-legacy-room-messages
```

Install the systemd units from `deploy/`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now my-telegram-web
sudo systemctl enable --now my-telegram-socket
```

Check:

```bash
sudo systemctl status my-telegram-web
sudo systemctl status my-telegram-socket
journalctl -u my-telegram-web -f
journalctl -u my-telegram-socket -f
```

The reverse proxy should send the public HTTPS hostname to port 3000. If Socket.IO is served through the same hostname, proxy WebSocket upgrades to port 3001.

## Subsequent releases

```bash
cd /opt/my-telegram
git pull --ff-only origin main
npm ci
npm run build
sudo systemctl restart my-telegram-web my-telegram-socket
```

Do not commit environment files or expose MongoDB, Redis, ClamAV, or S3 credentials publicly.

CI must remain green before changes are merged to `main`.
