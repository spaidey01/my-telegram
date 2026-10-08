import nodeTest, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io as createClient } from "socket.io-client";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import UserSchema from "../src/schemas/userSchema.js";
import SessionSchema from "../src/schemas/sessionSchema.js";
import RoomSchema from "../src/schemas/roomSchema.js";

const test = (name, fn) => nodeTest(name, { timeout: 45_000 }, fn);

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/my_telegram_multinode_test";
process.env.secretKey ||= "multinode-test-secret-key-32-bytes-minimum";
process.env.CLIENT_ORIGIN ||= "http://localhost:3000";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";
process.env.SOCKET_HANDSHAKE_IP_LIMIT ||= "1000";
process.env.SOCKET_HANDSHAKE_USER_LIMIT ||= "1000";

const nodes = [
  { port: 3102, process: null },
  { port: 3103, process: null },
];

let user;
let otherUser;
let userSession;
let otherUserSession;
let room;

const waitFor = (socket, event, timeout = 8_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for " + event)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const waitForServer = (child) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket server did not start")), 15_000);
    const onData = (chunk) => {
      if (chunk.toString().includes("Socket server is running")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error("Socket server exited with code " + code));
    });
  });

const tokenFor = (uid, session) =>
  jwt.sign(
    { sub: uid.toString(), sv: 0, sid: session._id.toString(), scope: "socket" },
    process.env.secretKey,
    { expiresIn: "5m" },
  );

const connectTo = async (port, uid, session) => {
  const socket = createClient("http://127.0.0.1:" + port, {
    auth: { token: tokenFor(uid, session) },
    transports: ["websocket"],
  });
  await waitFor(socket, "connect");
  return socket;
};

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const suffix = Date.now().toString().slice(-10);
  user = await UserSchema.create({
    name: "multinode",
    username: "mn_" + suffix,
    phone: "mn_" + suffix,
    password: "not-a-real-password",
    sessionVersion: 0,
  });
  otherUser = await UserSchema.create({
    name: "multinode-other",
    username: "mno_" + suffix,
    phone: "mno_" + suffix,
    password: "not-a-real-password",
    sessionVersion: 0,
  });
  [userSession, otherUserSession] = await SessionSchema.create([
    { user: user._id, device: "multinode", ip: "127.0.0.1", userAgent: "multinode-test" },
    { user: otherUser._id, device: "multinode", ip: "127.0.0.1", userAgent: "multinode-test" },
  ]);
  room = await RoomSchema.create({
    name: "Multi-node Call Room",
    type: "private",
    creator: user._id,
    participants: [user._id, otherUser._id],
    admins: [user._id],
    privateKey: [user._id.toString(), otherUser._id.toString()].sort().join(":"),
  });

  for (const node of nodes) {
    node.process = spawn(process.execPath, ["server/index.js"], {
      env: { ...process.env, SOCKET_PORT: String(node.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    node.process.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }
  await Promise.all(nodes.map((node) => waitForServer(node.process)));
});

after(async () => {
  for (const node of nodes) {
    if (node.process && !node.process.killed) {
      node.process.kill("SIGTERM");
      await new Promise((resolve) => node.process.once("exit", resolve));
    }
  }
  if (room) await RoomSchema.deleteOne({ _id: room._id });
  if (user || otherUser) {
    await SessionSchema.deleteMany({ user: { $in: [user?._id, otherUser?._id].filter(Boolean) } });
    await UserSchema.deleteMany({ _id: { $in: [user?._id, otherUser?._id].filter(Boolean) } });
  }
  await mongoose.disconnect();
});

test("presence and typing cross real Socket.IO nodes through the Redis adapter", async () => {
  const node1User = await connectTo(3102, user._id, userSession);
  const node2Other = await connectTo(3103, otherUser._id, otherUserSession);
  try {
    const presence = waitFor(node2Other, "userPresence");
    await presence;
    const typing = waitFor(node2Other, "typing");
    node1User.emit("joining", room._id.toString());
    node2Other.emit("joining", room._id.toString());
    await Promise.all([waitFor(node1User, "joining"), waitFor(node2Other, "joining")]);
    node1User.emit("typing", { roomID: room._id.toString() });
    const event = await typing;
    assert.equal(event.roomID, room._id.toString());
    assert.equal(String(event.sender._id), user._id.toString());
  } finally {
    node1User.disconnect();
    node2Other.disconnect();
  }
});

test("call signaling crosses nodes and keeps active call state in shared Redis", async () => {
  const caller = await connectTo(3102, user._id, userSession);
  const callee = await connectTo(3103, otherUser._id, otherUserSession);
  const callId = crypto.randomUUID();
  try {
    const incoming = waitFor(callee, "call:incoming");
    caller.emit("call:invite", {
      callId,
      roomID: room._id.toString(),
      targetUserID: otherUser._id.toString(),
      type: "audio",
    }, (result) => assert.equal(result.success, true));
    const incomingData = await incoming;
    assert.equal(incomingData.callId, callId);

    const accepted = waitFor(caller, "call:accepted");
    callee.emit("call:accept", { callId }, (result) => assert.equal(result.success, true));
    await accepted;

    const offer = waitFor(callee, "call:offer");
    caller.emit("call:offer", { callId, description: { type: "offer", sdp: "v=0\r\n" } });
    await offer;

    const answer = waitFor(caller, "call:answer");
    callee.emit("call:answer", { callId, description: { type: "answer", sdp: "v=0\r\n" } });
    await answer;

    const remoteIce = waitFor(callee, "call:ice");
    caller.emit("call:ice", { callId, candidate: { candidate: "candidate:1 1 UDP 1 127.0.0.1 9 typ host" } });
    const ice = await remoteIce;
    assert.equal(ice.callId, callId);

    const ended = waitFor(callee, "call:ended");
    caller.emit("call:end", { callId }, (result) => assert.equal(result.success, true));
    await ended;
  } finally {
    caller.disconnect();
    callee.disconnect();
  }
});

test("revoking one shared session disconnects sockets on both nodes before protected mutations", async () => {
  const node1 = await connectTo(3102, user._id, userSession);
  const node2 = await connectTo(3103, user._id, userSession);
  try {
    await SessionSchema.updateOne({ _id: userSession._id }, { $set: { revokedAt: new Date() } });

    const result1 = new Promise((resolve) => node1.emit("getRooms", resolve));
    const result2 = new Promise((resolve) => node2.emit("getRooms", resolve));
    const [a, b] = await Promise.all([result1, result2]);
    assert.equal(a.error, "Unauthorized");
    assert.equal(b.error, "Unauthorized");
  } finally {
    node1.disconnect();
    node2.disconnect();
  }
});
