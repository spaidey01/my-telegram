import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io as createClient } from "socket.io-client";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import UserSchema from "../src/schemas/userSchema.js";
import RoomSchema from "../src/schemas/roomSchema.js";
import MessageSchema from "../src/schemas/messageSchema.js";

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/my_telegram_test";
process.env.secretKey ||= "integration-test-secret-012345678901234567890123";
process.env.SOCKET_PORT ||= "3101";
process.env.CLIENT_ORIGIN ||= "http://localhost:3000";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

let serverProcess;
let user;
let otherUser;
let thirdUser;

const waitFor = (socket, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for " + event)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const waitForServer = () =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket server did not start")), 10000);
    const onData = (chunk) => {
      if (chunk.toString().includes("Socket server is running")) {
        clearTimeout(timer);
        serverProcess.stdout.off("data", onData);
        resolve();
      }
    };
    serverProcess.stdout.on("data", onData);
    serverProcess.once("error", reject);
    serverProcess.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error("Socket server exited with code " + code));
    });
  });

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const suffix = Date.now().toString().slice(-10);
  user = await UserSchema.create({
    name: "integration",
    username: "int_" + suffix,
    phone: "int_" + suffix,
    password: "not-a-real-password",
    sessionVersion: 0,
  });
  otherUser = await UserSchema.create({
    name: "other",
    username: "other_" + suffix,
    phone: "other_" + suffix,
    password: "not-a-real-password",
    sessionVersion: 0,
  });
  thirdUser = await UserSchema.create({
    name: "third",
    username: "third_" + suffix,
    phone: "third_" + suffix,
    password: "not-a-real-password",
    sessionVersion: 0,
  });

  serverProcess = spawn(process.execPath, ["server/index.js"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();
});

after(async () => {
  if (user) {
    await RoomSchema.deleteMany({ creator: user._id });
    await UserSchema.deleteMany({ _id: { $in: [user._id, otherUser?._id, thirdUser?._id].filter(Boolean) } });
  }
  await mongoose.disconnect();

  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
});

test("socket authentication, invite-link authorization and message flow", async () => {
  const room = await RoomSchema.create({
    name: "Integration Room",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id],
    link: "@integration_" + Date.now(),
  });

  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");

    const joinErrorPromise = waitFor(socket, "joinRoomError");
    socket.emit("joinRoom", { roomID: room._id.toString(), link: "@wrong" });
    const joinError = await joinErrorPromise;
    assert.equal(joinError.message, "This room is not publicly joinable");

    const joinPromise = waitFor(socket, "joinRoom");
    socket.emit("joinRoom", { roomID: room._id.toString(), link: room.link });
    const joined = await joinPromise;
    assert.equal(joined.roomID, room._id.toString());

    const messagePromise = waitFor(socket, "newMessageIdUpdate");
    socket.emit("newMessage", {
      roomID: room._id.toString(),
      message: "integration message",
      tempId: "integration-temp-" + Date.now(),
    });
    const message = await messagePromise;
    assert.ok(message._id);
  } finally {
    socket.disconnect();
    await RoomSchema.deleteOne({ _id: room._id });
  }
});




test("reply, edit, reaction, pin, forward and delete message flow", async () => {
  const room = await RoomSchema.create({
    name: "Feature Flow Room",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const targetRoom = await RoomSchema.create({
    name: "Forward Target",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });

  const makeSocket = (uid) =>
    createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: uid.toString(), sv: 0, scope: "socket" },
          process.env.secretKey,
          { expiresIn: "5m" },
        ),
      },
      transports: ["websocket"],
    });

  const socket = makeSocket(user._id);
  const otherSocket = makeSocket(otherUser._id);

  try {
    await Promise.all([waitFor(socket, "connect"), waitFor(otherSocket, "connect")]);
    const join = (s, roomID) => new Promise((resolve) => {
      s.emit("joining", roomID);
      s.once("joining", resolve);
    });
    await Promise.all([join(socket, room._id.toString()), join(otherSocket, room._id.toString())]);
    await join(socket, targetRoom._id.toString());

    const send = (payload) =>
      new Promise((resolve) => socket.emit("newMessage", payload, resolve));

    const originalTemp = "original-" + Date.now();
    const originalResult = await send({
      roomID: room._id.toString(),
      message: "original",
      tempId: originalTemp,
    });
    assert.equal(originalResult.success, true);
    const original = await MessageSchema.findById(originalResult._id).lean();
    assert.equal(original.message, "original");

    const replyResult = await send({
      roomID: room._id.toString(),
      message: "reply",
      replayData: { targetID: originalResult._id },
      tempId: "reply-" + Date.now(),
    });
    assert.equal(replyResult.success, true);
    const reply = await MessageSchema.findById(replyResult._id).lean();
    assert.equal(reply.replayedTo.msgID, originalResult._id.toString());
    assert.equal(reply.replayedTo.username, user.username);

    const editResult = await new Promise((resolve) => {
      socket.emit("editMessage", {
        msgID: replyResult._id,
        editedMsg: "edited reply",
        roomID: room._id.toString(),
      });
      socket.once("editMessage", resolve);
    });
    assert.equal(editResult.msgID, replyResult._id);
    assert.equal(editResult.editedMsg, "edited reply");
    assert.equal((await MessageSchema.findById(replyResult._id)).message, "edited reply");

    const reactionResult = await new Promise((resolve) => {
      socket.emit(
        "toggleReaction",
        { msgID: originalResult._id, roomID: room._id.toString(), emoji: "❤️" },
        resolve,
      );
    });
    assert.equal(reactionResult.success, true);
    const reacted = await MessageSchema.findById(originalResult._id).lean();
    assert.deepEqual(reacted.reactions[0].userIds.map(String), [user._id.toString()]);

    const pinPromise = waitFor(otherSocket, "pinMessage");
    socket.emit("pinMessage", originalResult._id, room._id.toString(), false);
    const pinEvent = await pinPromise;
    assert.equal(pinEvent.msgID, originalResult._id);
    assert.equal(pinEvent.roomID, room._id.toString());
    assert.ok(pinEvent.pinnedAt);
    assert.ok((await MessageSchema.findById(originalResult._id)).pinnedAt);

    const forwardResult = await new Promise((resolve) => {
      socket.emit(
        "forwardMessage",
        {
          msgID: originalResult._id,
          sourceRoomID: room._id.toString(),
          targetRoomID: targetRoom._id.toString(),
        },
        resolve,
      );
    });
    assert.equal(forwardResult.success, true);
    assert.equal(forwardResult.message.forwardedFrom.messageId, originalResult._id);

    socket.emit("deleteMsg", {
      forAll: true,
      msgID: replyResult._id,
      roomID: room._id.toString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await MessageSchema.exists({ _id: replyResult._id }), null);
  } finally {
    socket.disconnect();
    otherSocket.disconnect();
    await MessageSchema.deleteMany({ roomID: { $in: [room._id, targetRoom._id] } });
    await RoomSchema.deleteMany({ _id: { $in: [room._id, targetRoom._id] } });
  }
});


test("private rooms cannot be administratively modified or deleted", async () => {
  const room = await RoomSchema.create({
    name: "Private Integration",
    type: "private",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });

  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");

    const updateErrorPromise = waitFor(socket, "updateRoomDataError");
    socket.emit("updateRoomData", {
      roomID: room._id.toString(),
      name: "Hijacked name",
      participants: [user._id.toString(), thirdUser._id.toString()],
    });
    const updateError = await updateErrorPromise;
    assert.equal(updateError.message, "Private rooms cannot be administratively modified");

    const deleteErrorPromise = waitFor(socket, "error");
    socket.emit("deleteRoom", room._id.toString());
    const deleteError = await deleteErrorPromise;
    assert.equal(deleteError.message, "Forbidden");

    const unchanged = await RoomSchema.findById(room._id).lean();
    assert.deepEqual(
      unchanged.participants.map(String).sort(),
      [user._id.toString(), otherUser._id.toString()].sort(),
    );
  } finally {
    socket.disconnect();
    await RoomSchema.deleteOne({ _id: room._id });
  }
});

test("server rejects non-hex public room links", async () => {
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });
  const roomName = "Invalid Link " + Date.now();

  try {
    await waitFor(socket, "connect");
    socket.emit("createRoom", {
      newRoomData: {
        name: roomName,
        type: "group",
        participants: [user._id.toString()],
        link: "@victim_username",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const room = await RoomSchema.findOne({ name: roomName }).lean();
    assert.equal(room, null);
  } finally {
    socket.disconnect();
    await RoomSchema.deleteMany({ name: roomName });
  }
});


test("room read marker clears unread messages through the referenced message", async () => {
  const room = await RoomSchema.create({
    name: "Read Integration",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });

  const makeSocket = (uid) =>
    createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: uid.toString(), sv: 0, scope: "socket" },
          process.env.secretKey,
          { expiresIn: "5m" },
        ),
      },
      transports: ["websocket"],
    });

  const socket = makeSocket(user._id);
  const otherSocket = makeSocket(otherUser._id);

  try {
    await Promise.all([waitFor(socket, "connect"), waitFor(otherSocket, "connect")]);

    const join = (s) => new Promise((resolve) => {
      s.emit("joining", room._id.toString());
      s.once("joining", resolve);
    });
    await Promise.all([join(socket), join(otherSocket)]);

    const send = (message) =>
      new Promise((resolve) => {
        socket.emit("newMessage", {
          roomID: room._id.toString(),
          message,
          tempId: "read-" + Date.now() + "-" + Math.random(),
        }, resolve);
      });

    const first = await send("first unread");
    const second = await send("second unread");

    const readEvent = waitFor(socket, "roomRead");
    otherSocket.emit("markRoomRead", {
      roomID: room._id.toString(),
      messageID: second._id,
    });
    const payload = await readEvent;

    assert.equal(payload.roomID, room._id.toString());
    assert.equal(payload.messageID, second._id);
    assert.equal(payload.readBy, otherUser._id.toString());
    assert.equal(payload.unreadCount, 0);

    const [firstDoc, secondDoc] = await Promise.all([
      MessageSchema.findById(first._id).lean(),
      MessageSchema.findById(second._id).lean(),
    ]);
    assert.ok(firstDoc.seen.map(String).includes(otherUser._id.toString()));
    assert.ok(secondDoc.seen.map(String).includes(otherUser._id.toString()));
  } finally {
    socket.disconnect();
    otherSocket.disconnect();
    await MessageSchema.deleteMany({ roomID: room._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});


test("room read marker rejects non-members and invalid target messages", async () => {
  const room = await RoomSchema.create({
    name: "Read Authorization Integration",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: thirdUser._id.toString(), sv: 0, scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });
  try {
    await waitFor(socket, "connect");
    const result = await new Promise((resolve) => {
      socket.emit("markRoomRead", {
        roomID: room._id.toString(),
        messageID: new mongoose.Types.ObjectId().toString(),
      }, resolve);
    });
    assert.equal(result.success, false);
    assert.equal(result.error, "Forbidden");
  } finally {
    socket.disconnect();
    await MessageSchema.deleteMany({ roomID: room._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});


test("last seen handles multi-socket presence and reconnects", async () => {
  const makeSocket = (uid) =>
    createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: uid.toString(), sv: 0, scope: "socket" },
          process.env.secretKey,
          { expiresIn: "5m" },
        ),
      },
      transports: ["websocket"],
    });

  const observer = makeSocket(user._id);
  const targetA = makeSocket(otherUser._id);
  const targetB = makeSocket(otherUser._id);

  try {
    await waitFor(observer, "connect");
    const onlinePresence = waitFor(observer, "userPresence");
    await Promise.all([waitFor(targetA, "connect"), waitFor(targetB, "connect")]);
    const online = await onlinePresence;
    assert.equal(online.userID, otherUser._id.toString());
    assert.equal(online.status, "online");

    const onlineUser = await UserSchema.findById(otherUser._id).lean();
    assert.equal(onlineUser.status, "online");

    targetA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const stillOnline = await UserSchema.findById(otherUser._id).lean();
    assert.equal(stillOnline.status, "online");
    assert.equal(stillOnline.lastSeenAt, null);

    const offlinePresence = waitFor(observer, "userPresence");
    targetB.disconnect();
    const offline = await offlinePresence;
    assert.equal(offline.userID, otherUser._id.toString());
    assert.equal(offline.status, "offline");
    assert.ok(offline.lastSeenAt);

    const lastSeenAt = offline.lastSeenAt;
    const offlineUser = await UserSchema.findById(otherUser._id).lean();
    assert.equal(offlineUser.status, "offline");
    assert.ok(offlineUser.lastSeenAt);

    const reconnectPresence = waitFor(observer, "userPresence");
    const targetReconnect = makeSocket(otherUser._id);
    try {
      await waitFor(targetReconnect, "connect");
      const reconnected = await reconnectPresence;
      assert.equal(reconnected.userID, otherUser._id.toString());
      assert.equal(reconnected.status, "online");
      assert.ok(reconnected.lastSeenAt);
      assert.equal(new Date(reconnected.lastSeenAt).getTime(), new Date(lastSeenAt).getTime());

      const reconnectedUser = await UserSchema.findById(otherUser._id).lean();
      assert.equal(reconnectedUser.status, "online");
      assert.equal(new Date(reconnectedUser.lastSeenAt).getTime(), new Date(lastSeenAt).getTime());
    } finally {
      targetReconnect.disconnect();
    }
  } finally {
    observer.disconnect();
    targetA.disconnect();
    targetB.disconnect();
    await UserSchema.updateOne(
      { _id: otherUser._id },
      { $set: { status: "offline" } },
    );
  }
});
