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
    "retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null)",
    "if(retryTimer.current)clearTimeout(retryTimer.current)",
    "retryTimer.current=null",
    "scheduleRetryUnlock",
    "PERMISSION_DENIED",
    "setInterval(()=>setSeconds",
    "call:peer-reconnecting",
    "isCaller",
    "qualityPrevious",
    "MAX_PENDING_ICE_CANDIDATES=128",
    "getCandidateUfrag",
    "matchesRemoteIceGeneration",
    "pending.current.length>=MAX_PENDING_ICE_CANDIDATES",
    "getCandidateUfrag(item)===ufrag",
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
    '!["offer", "answer"].includes(description.type)',
    'description.sdp.length > 256_000',
    'description.type !== "answer"',
    'allowEvent(userID, "call:answer", 60, 60_000)',
    'allowEvent(userID, "call:ice", 300, 60_000)',
    'if (!c || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;',
    'candidate.candidate.length > 8_192',
    '!Number.isInteger(candidate.sdpMLineIndex)',
    'candidate.usernameFragment.length > 256',
    'const isCaller = c.caller === userID && socket.id === c.callerSocketId;',
    'const isCallee = c.callee === userID && socket.id === c.calleeSocketId;',
    'if (!isCaller && !isCallee) return;',
    'allowEvent(userID, "call:end", 30, 60_000)',
  ]) assert.ok(server.includes(token),`missing server recovery primitive: ${token}`);
});


test("call invite uses an atomic per-participant reservation",()=>{
  for(const token of [
    "CALL_RESERVATION_PREFIX",
    "reserveCallParticipants",
    "redisPubClient.eval",
    'redis.call("GET", KEYS[1])',
    'redis.call("GET", KEYS[2])',
    'redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])',
    "renewCallParticipants",
    "releaseCallParticipants",
    "Call reservation lost",
  ]) assert.ok(server.includes(token),`missing atomic call reservation primitive: ${token}`);
});
