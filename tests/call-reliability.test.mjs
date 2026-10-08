import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const overlay=fs.readFileSync(new URL("../src/components/CallOverlay.tsx",import.meta.url),"utf8");
const server=fs.readFileSync(new URL("../server/index.js",import.meta.url),"utf8");

test("call reliability client has recovery primitives",()=>{
  for(const token of [
    "sessionStorage",
    "socket?.connected",
    "createOffer({iceRestart:true})",
    "getStats()",
    "addEventListener(\"online\"",
    "addEventListener(\"offline\"",
    "call:reconnect",
    "call:retry",
    "PERMISSION_DENIED",
    "setInterval(()=>setSeconds",
    "call:peer-reconnecting",
    "isCaller",
    "qualityPrevious",
    "removeEventListener(\"change\",onConnectionChange)",
    "if(!durationTimer.current)beginDuration();",
    'setLocalDescription({type:"rollback"})',
    'signalingState!=="stable"',
  ]) assert.ok(overlay.includes(token),`missing reliability primitive: ${token}`);
});

test("call reliability server keeps a reconnect grace window",()=>{
  for(const token of [
    "CALL_RECONNECT_GRACE_MS",
    'on("call:reconnect"',
    'on("call:retry"',
    '"call:peer-reconnecting"',
    '"call:peer-reconnected"',
    "retryCount: 0",
    "restart = false",
    "if (restart && !isCaller) return;",
    "CALL_REDIS_SET",
    "getActiveCall",
    "setActiveCall",
    "io.in(c.callerSocketId).fetchSockets()",
    "io.to(targetSocketId).emit",
    "acceptedAt",
    "CALL_ACTIVE_TTL_MS",
    "const effectiveTtl = ttlMs ?? (call.acceptedAt ? CALL_ACTIVE_TTL_MS",
    "if (!active || active.acceptedAt) return;",
    'allowEvent(userID, "call:accept", 30, 60_000)',
    'allowEvent(userID, "call:offer", 60, 60_000)',
    'allowEvent(userID, "call:answer", 60, 60_000)',
    'allowEvent(userID, "call:ice", 300, 60_000)',
    'allowEvent(userID, "call:end", 30, 60_000)',
  ]) assert.ok(server.includes(token),`missing server recovery primitive: ${token}`);
});
