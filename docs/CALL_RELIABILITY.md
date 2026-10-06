# Call Reliability

Stage 13 hardens Stargram WebRTC calls around transient failures.

## Implemented

- Reconnect after Socket.IO transport interruption.
- Distributed active-call state in Redis when `REDIS_URL` is configured, with local Map fallback only for non-production mode.
- Cluster-safe signaling through Socket.IO adapter routing and cross-node socket lookup.
- Server-side reconnect grace window: 20 seconds.
- ICE restart using `createOffer({ iceRestart: true })`.
- Automatic ICE restart on `disconnected` / `failed` ICE or peer states.
- Network online/offline handling and network-change recovery.
- Bounded retry signaling (maximum two server-side retry attempts per active call).
- Connection-quality monitoring from `RTCPeerConnection.getStats()` with excellent/good/poor states.
- Permission error handling for microphone/camera failures.
- Client call-state persistence in `sessionStorage` so a page/socket recovery can resume the call UI.
- Call duration timer.
- Explicit reconnecting / failed / offline UI states.
- Existing mute, camera, accept, reject, timeout, offer, answer and ICE flows remain intact.

## Recovery model

A normal Socket.IO disconnect no longer immediately terminates an active call. Active-call metadata is shared through Redis in distributed deployments, while the Socket.IO Redis adapter routes signaling packets to sockets on other nodes. The server keeps the call for a short grace period and updates the socket endpoint when the user reconnects.

The browser also persists the active call identity locally. On socket reconnection it asks the server to restore the call binding and triggers ICE recovery.

## Quality model

The browser samples WebRTC stats every three seconds while connected. RTT, jitter and packet loss are used as a lightweight user-facing quality signal. This is intentionally a UI signal, not a billing or telemetry metric.

## What automated checks prove

CI verifies:

1. TypeScript, ESLint and Next.js build.
2. Node syntax for the Socket.IO server.
3. Real coturn REST authentication.
4. TURN credential tests.
5. Reliability contract tests covering reconnect, retry, ICE restart, stats, network events, permission UI and persistence.
6. Existing Socket.IO integration tests.

## What still requires real devices

Automated CI cannot honestly prove browser media recovery across physical network changes. Final E2E verification still requires two independent browsers/devices and a deployed TURN service. The acceptance test is:

- establish audio and video calls;
- disable/re-enable network on one peer;
- confirm the UI enters reconnecting and returns to connected;
- force an ICE failure and confirm ICE restart;
- switch networks where possible;
- verify the call timer remains monotonic;
- deny microphone/camera permission and confirm actionable error UI;
- verify relay candidates when TURN is active.
