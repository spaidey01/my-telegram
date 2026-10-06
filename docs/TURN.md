# TURN / WebRTC deployment

Stargram uses WebRTC for media and Socket.IO only for signaling. TURN belongs in the WebRTC ICE configuration; it does not replace the existing call signaling events.

## Runtime configuration

Required in production:

- `TURN_URL`: one or more `turn:` / `turns:` URLs, comma-separated.
- `TURN_SECRET`: preferred. Must exactly match coturn `static-auth-secret`.
- `TURN_CREDENTIAL_TTL_SECONDS`: ephemeral credential lifetime; default 600 seconds.

Compatibility fallback:

- `TURN_USERNAME`
- `TURN_CREDENTIAL`

Never prefix TURN secrets with `NEXT_PUBLIC_`.

## Credential flow

1. The browser authenticates to Stargram using its normal session cookie.
2. `GET /api/calls/turn-credentials` verifies the session and applies an IP rate limit.
3. The server creates a short-lived TURN username and HMAC-SHA1 credential when `TURN_SECRET` is configured.
4. The browser passes the returned `iceServers` to `RTCPeerConnection`.
5. Socket.IO continues to relay only SDP/ICE signaling.
6. coturn validates the ephemeral credential and provides the media relay.

The TURN credential must reach the browser because WebRTC needs it to authenticate to TURN. The security boundary is therefore short lifetime + authenticated issuance, not pretending that a browser-visible credential can remain secret.

## coturn

The repository contains:

- `turn/turnserver.conf.example`
- `turn/docker-compose.yml`

For a public production server, expose:

- UDP/TCP 3478
- TLS 5349 if using `turns:`
- the configured relay UDP range (default example: 49160-49200)

Coturn's official Docker documentation recommends host networking for large relay-port ranges and documents the same listener/relay-port requirements. See the official coturn documentation for the final network/firewall setup. 

If the TURN server is behind NAT, configure its public/private mapping with coturn's `external-ip` setting. Do not publish a TURN URL that points at a private container address.

## Production checklist

- [ ] DNS for the TURN hostname points to the public TURN host.
- [ ] `TURN_URL` uses the public hostname.
- [ ] `TURN_SECRET` is a strong random secret and is identical on Stargram and coturn.
- [ ] `TURN_SECRET` is stored only in server-side secret storage.
- [ ] `TURN_CREDENTIAL_TTL_SECONDS` is short enough for the threat model.
- [ ] UDP/TCP 3478 is reachable.
- [ ] The entire configured relay UDP range is reachable.
- [ ] TLS certificate/key are configured before enabling `turns:`.
- [ ] `external-ip` is configured when the TURN host is behind NAT.
- [ ] CI's real coturn allocation test passes.
- [ ] Two real browsers can establish a call from networks that cannot directly reach each other.

## Verification

Automated checks cover:

- ephemeral credential shape and TTL
- HMAC credential correctness
- static credential fallback
- rejection of incomplete TURN authentication
- a real coturn TURN allocation in CI

The final end-to-end browser test cannot be honestly declared complete from CI alone: it requires two browser peers on separate networks (or a browser automation environment with WebRTC support) and a publicly reachable TURN host. Until those deployment inputs exist, claiming "TURN production verified" would be false.
