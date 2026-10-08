import { test, expect } from "@playwright/test";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
});
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import UserSchema from "../src/schemas/userSchema.js";
import SessionSchema from "../src/schemas/sessionSchema.js";
import RoomSchema from "../src/schemas/roomSchema.js";
import { buildTurnIceServers } from "../src/utils/turnCredentials.js";

const SOCKET_PORT = 3104;
const PAGE_PORT = 4173;
const SECRET = process.env.secretKey || "browser-webrtc-e2e-secret-key-32-bytes";
const MONGO = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/my_telegram_webrtc_e2e";
const PAGE = `<!doctype html><html><body><script src="http://127.0.0.1:${SOCKET_PORT}/socket.io/socket.io.js"></script><script>
window.bootstrap = async (token, iceServers) => {
  const socket = io("http://127.0.0.1:${SOCKET_PORT}", { auth: { token }, transports: ["websocket"] });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  const state = { socket, pc: null, stream: null, remoteTracks: 0, connected: false, callId: null, iceServers };
  window.callState = state;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const makePeer = async (callId, caller) => {
    state.callId = callId;
    state.pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    for (const track of state.stream.getTracks()) state.pc.addTrack(track, state.stream);
    state.pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit("call:ice", { callId, candidate: event.candidate.toJSON() });
    };
    state.pc.ontrack = (event) => { state.remoteTracks += event.streams?.[0]?.getTracks?.().length || 1; };
    state.pc.onconnectionstatechange = () => {
      state.connected = state.pc.connectionState === "connected";
    };
    socket.on("call:ice", async ({ callId: incomingId, candidate }) => {
      if (incomingId !== state.callId || !state.pc) return;
      try { await state.pc.addIceCandidate(candidate); } catch {}
    });
    socket.on("call:offer", async ({ callId: incomingId, description }) => {
      if (incomingId !== state.callId || caller || !state.pc) return;
      await state.pc.setRemoteDescription(description);
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      socket.emit("call:answer", { callId, description: state.pc.localDescription });
    });
    socket.on("call:answer", async ({ callId: incomingId, description }) => {
      if (incomingId !== state.callId || !caller || !state.pc) return;
      await state.pc.setRemoteDescription(description);
    });
    return state.pc;
  };
  window.prepareCaller = async (callId) => {
    const pc = await makePeer(callId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call:offer", { callId, description: pc.localDescription });
  };
  window.prepareCallee = async (callId) => {
    const pc = await makePeer(callId, false);
    return pc;
  };
  window.getConnectionState = () => state.pc?.connectionState || "closed";
  window.forceIceFailure = async () => {
    if (!state.pc) throw new Error("peer connection is not ready");
    state.pc.setConfiguration({ iceServers: [], iceTransportPolicy: "relay" });
    const offer = await state.pc.createOffer({ iceRestart: true });
    await state.pc.setLocalDescription(offer);
    socket.emit("call:offer", { callId: state.callId, description: state.pc.localDescription, restart: true });
  };
  window.restoreIce = async () => {
    if (!state.pc) throw new Error("peer connection is not ready");
    state.pc.setConfiguration({ iceServers: state.iceServers, iceTransportPolicy: "relay" });
  };
  window.restartIce = async () => {
    if (!state.pc) throw new Error("peer connection is not ready");
    const offer = await state.pc.createOffer({ iceRestart: true });
    await state.pc.setLocalDescription(offer);
    socket.emit("call:offer", { callId: state.callId, description: state.pc.localDescription, restart: true });
  };
  window.disconnectSocket = () => socket.disconnect();
  window.reconnectSocket = async () => {
    socket.connect();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket reconnect timeout")), 8_000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
    });
    socket.emit("call:reconnect", { callId: state.callId });
  };
  socket.on("call:incoming", async ({ callId }) => {
    if (window.acceptIncoming) {
      await window.prepareCallee(callId);
      socket.emit("call:accept", { callId }, (result) => { window.acceptResult = result; });
    }
  });
  socket.on("call:accepted", () => { window.accepted = true; });
  return true;
};
</script></body></html>`;

let mongo;
let httpServer;
let socketProcess;
let user;
let otherUser;
let userSession;
let otherUserSession;
let room;

const waitForServer = (child, text) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server start timeout: " + text)), 15_000);
  const onData = (chunk) => {
    if (chunk.toString().includes(text)) {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve();
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.once("error", reject);
});

const tokenFor = (uid, session) => jwt.sign(
  { sub: uid.toString(), sv: 0, sid: session._id.toString(), scope: "socket" },
  SECRET,
  { expiresIn: "5m" },
);

test.beforeAll(async () => {
  process.env.MONGODB_URI = MONGO;
  process.env.secretKey = SECRET;
  process.env.REDIS_URL ||= "redis://127.0.0.1:6379";
  await mongoose.connect(MONGO);
  const suffix = crypto.randomBytes(5).toString("hex");
  user = await UserSchema.create({ name: "webrtc-e2e", username: "rtc_" + suffix, phone: "rtc_" + suffix, password: "not-real", sessionVersion: 0 });
  otherUser = await UserSchema.create({ name: "webrtc-peer", username: "rtcp_" + suffix, phone: "rtcp_" + suffix, password: "not-real", sessionVersion: 0 });
  [userSession, otherUserSession] = await SessionSchema.create([
    { user: user._id, device: "browser-e2e", ip: "127.0.0.1", userAgent: "playwright" },
    { user: otherUser._id, device: "browser-e2e", ip: "127.0.0.1", userAgent: "playwright" },
  ]);
  room = await RoomSchema.create({
    name: "Browser WebRTC E2E",
    type: "private",
    creator: user._id,
    participants: [user._id, otherUser._id],
    admins: [user._id],
    privateKey: [user._id.toString(), otherUser._id.toString()].sort().join(":"),
  });

  httpServer = createServer((req, res) => {
    if (req.url === "/peer.html") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(PAGE);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => httpServer.listen(PAGE_PORT, "127.0.0.1", resolve));

  socketProcess = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      MONGODB_URI: MONGO,
      secretKey: SECRET,
      REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      SOCKET_PORT: String(SOCKET_PORT),
      CLIENT_ORIGIN: `http://127.0.0.1:${PAGE_PORT}`,
      SOCKET_HANDSHAKE_IP_LIMIT: "1000",
      SOCKET_HANDSHAKE_USER_LIMIT: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(socketProcess, "Socket server is running");
});

test.afterAll(async () => {
  if (socketProcess && !socketProcess.killed) {
    socketProcess.kill("SIGTERM");
    await new Promise((resolve) => socketProcess.once("exit", resolve));
  }
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  if (room) await RoomSchema.deleteOne({ _id: room._id });
  if (user || otherUser) {
    await SessionSchema.deleteMany({ user: { $in: [user?._id, otherUser?._id].filter(Boolean) } });
    await UserSchema.deleteMany({ _id: { $in: [user?._id, otherUser?._id].filter(Boolean) } });
  }
  await mongoose.disconnect();
});

test("two real Chromium peers establish audio/video through Stargram call signaling", async ({ browser }) => {
  const callerContext = await browser.newContext({
    permissions: ["microphone", "camera"],
  });
  const calleeContext = await browser.newContext({
    permissions: ["microphone", "camera"],
  });
  const caller = await callerContext.newPage();
  const callee = await calleeContext.newPage();
  const turnIceServers = buildTurnIceServers(user._id.toString()).iceServers;
  await Promise.all([caller.goto("http://127.0.0.1:" + PAGE_PORT + "/peer.html"), callee.goto("http://127.0.0.1:" + PAGE_PORT + "/peer.html")]);
  await Promise.all([
    caller.evaluate(({ token, iceServers }) => window.bootstrap(token, iceServers), { token: tokenFor(user._id, userSession), iceServers: turnIceServers }),
    callee.evaluate(({ token, iceServers }) => window.bootstrap(token, iceServers), { token: tokenFor(otherUser._id, otherUserSession), iceServers: turnIceServers }),
  ]);
  await callee.evaluate(() => { window.acceptIncoming = true; });
  const callId = crypto.randomUUID();
  const invite = await caller.evaluate(({ callId, roomID, targetUserID }) => new Promise((resolve) => {
    window.callState.socket.emit("call:invite", { callId, roomID, targetUserID, type: "video" }, resolve);
  }), { callId, roomID: room._id.toString(), targetUserID: otherUser._id.toString() });
  expect(invite.success).toBe(true);

  await expect.poll(() => callee.evaluate(() => Boolean(window.acceptResult?.success)), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => caller.evaluate(() => Boolean(window.accepted)), { timeout: 10_000 }).toBe(true);
  await caller.evaluate((id) => window.prepareCaller(id), callId);

  await expect.poll(() => caller.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => callee.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => caller.evaluate(() => window.callState?.remoteTracks > 0), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => callee.evaluate(() => window.callState?.remoteTracks > 0), { timeout: 10_000 }).toBe(true);

  await caller.evaluate(() => new Promise((resolve) => {
    window.callState.socket.emit("call:end", { callId: window.callState.callId }, resolve);
  }));
  await callerContext.close();
  await calleeContext.close();
});



test("real browser peers recover from an induced ICE failure using TURN and ICE restart", async ({ browser }) => {
  const callerContext = await browser.newContext({ permissions: ["microphone", "camera"] });
  const calleeContext = await browser.newContext({ permissions: ["microphone", "camera"] });
  const caller = await callerContext.newPage();
  const callee = await calleeContext.newPage();
  const turnIceServers = buildTurnIceServers(user._id.toString()).iceServers;
  await Promise.all([
    caller.goto("http://127.0.0.1:" + PAGE_PORT + "/peer.html"),
    callee.goto("http://127.0.0.1:" + PAGE_PORT + "/peer.html"),
  ]);
  await Promise.all([
    caller.evaluate(({ token, iceServers }) => window.bootstrap(token, iceServers), { token: tokenFor(user._id, userSession), iceServers: turnIceServers }),
    callee.evaluate(({ token, iceServers }) => window.bootstrap(token, iceServers), { token: tokenFor(otherUser._id, otherUserSession), iceServers: turnIceServers }),
  ]);
  await callee.evaluate(() => { window.acceptIncoming = true; });
  const callId = crypto.randomUUID();
  const invite = await caller.evaluate(({ callId, roomID, targetUserID }) => new Promise((resolve) => {
    window.callState.socket.emit("call:invite", { callId, roomID, targetUserID, type: "audio" }, resolve);
  }), { callId, roomID: room._id.toString(), targetUserID: otherUser._id.toString() });
  expect(invite.success).toBe(true);
  await expect.poll(() => callee.evaluate(() => Boolean(window.acceptResult?.success)), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => caller.evaluate(() => Boolean(window.accepted)), { timeout: 10_000 }).toBe(true);
  await caller.evaluate((id) => window.prepareCaller(id), callId);
  await expect.poll(() => caller.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => callee.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);

  execFileSync("pkill", ["-x", "turnserver"]);
  await expect.poll(() => caller.evaluate(() => window.getConnectionState()), { timeout: 20_000 }).not.toBe("connected");

  const restartedTurn = spawn("turnserver", [
    "-n", "--log-file=stdout", "--use-auth-secret",
    "--static-auth-secret=" + process.env.TURN_SECRET,
    "--realm=ci.turn.stargram.local", "--fingerprint",
    "--no-tls", "--no-dtls", "--no-multicast-peers", "--allow-loopback-peers",
    "--cli-password=ci-cli-password-0123456789", "--userdb=/tmp/stargram-coturn.db",
    "--min-port=49160", "--max-port=49200",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await caller.evaluate(() => window.restoreIce());
  await caller.evaluate(() => window.restartIce());
  restartedTurn.unref();
  await expect.poll(() => caller.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => callee.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);

  await callerContext.close();
  await calleeContext.close();
});

test("real browser peers survive ICE restart and Socket.IO disconnect/reconnect signaling", async ({ browser }) => {
  const callerContext = await browser.newContext({ permissions: ["microphone", "camera"] });
  const calleeContext = await browser.newContext({ permissions: ["microphone", "camera"] });
  const caller = await callerContext.newPage();
  const callee = await calleeContext.newPage();
  const turnIceServers = buildTurnIceServers(user._id.toString()).iceServers;
  await Promise.all([caller.goto("http://127.0.0.1:" + PAGE_PORT + "/peer.html"), callee.goto("http://127.0.0.1:" + PAGE_PORT + "/peer.html")]);
  await Promise.all([
    caller.evaluate(({ token, iceServers }) => window.bootstrap(token, iceServers), { token: tokenFor(user._id, userSession), iceServers: turnIceServers }),
    callee.evaluate(({ token, iceServers }) => window.bootstrap(token, iceServers), { token: tokenFor(otherUser._id, otherUserSession), iceServers: turnIceServers }),
  ]);
  await callee.evaluate(() => { window.acceptIncoming = true; });
  const callId = crypto.randomUUID();
  const invite = await caller.evaluate(({ callId, roomID, targetUserID }) => new Promise((resolve) => {
    window.callState.socket.emit("call:invite", { callId, roomID, targetUserID, type: "audio" }, resolve);
  }), { callId, roomID: room._id.toString(), targetUserID: otherUser._id.toString() });
  expect(invite.success).toBe(true);
  await expect.poll(() => callee.evaluate(() => Boolean(window.acceptResult?.success)), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => caller.evaluate(() => Boolean(window.accepted)), { timeout: 10_000 }).toBe(true);
  await caller.evaluate((id) => window.prepareCaller(id), callId);
  await expect.poll(() => caller.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => callee.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);

  await caller.evaluate(() => window.restartIce());
  await expect.poll(() => caller.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => callee.evaluate(() => window.callState?.connected), { timeout: 20_000 }).toBe(true);

  await caller.evaluate(() => window.disconnectSocket());
  await expect.poll(() => caller.evaluate(() => Boolean(window.callState?.socket?.disconnected)), { timeout: 5_000 }).toBe(true);
  await caller.evaluate(() => window.reconnectSocket());
  await expect.poll(() => caller.evaluate(() => Boolean(window.callState?.socket?.connected)), { timeout: 10_000 }).toBe(true);

  await callerContext.close();
  await calleeContext.close();
});
