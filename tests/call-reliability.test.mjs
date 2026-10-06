import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const overlay=fs.readFileSync(new URL("../src/components/CallOverlay.tsx",import.meta.url),"utf8");
const server=fs.readFileSync(new URL("../server/index.js",import.meta.url),"utf8");

test("call reliability client has recovery primitives",()=>{
  for(const token of [
    "sessionStorage",
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
  ]) assert.ok(server.includes(token),`missing server recovery primitive: ${token}`);
});
