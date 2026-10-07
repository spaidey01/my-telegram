import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io as createClient } from "socket.io-client";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import UserSchema from "../src/schemas/userSchema.js";
import SessionSchema from "../src/schemas/sessionSchema.js";
import RoomSchema from "../src/schemas/roomSchema.js";
import MessageSchema from "../src/schemas/messageSchema.js";
import FileSchema from "../src/schemas/fileSchema.js";
import StickerSchema from "../src/schemas/stickerSchema.js";
import StickerPackSchema from "../src/schemas/stickerPackSchema.js";
import UserStickerPackSchema from "../src/schemas/userStickerPackSchema.js";
import ScheduledMessageSchema from "../src/schemas/scheduledMessageSchema.js";
import { canViewPrivacy } from "../src/utils/privacy.js";
import { EMPTY_MESSAGE_SELECTION, enterMessageSelection, toggleMessageSelection, selectAllMessages, pruneMessageSelection, replaceMessageSelection } from "../src/utils/messageSelection.js";

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/my_telegram_test";
process.env.secretKey ||= "integration-test-secret-012345678901234567890123";
process.env.SOCKET_PORT ||= "3101";
process.env.CLIENT_ORIGIN ||= "http://localhost:3000";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

let serverProcess;
let user;
let otherUser;
let thirdUser;
let userSession;
let otherUserSession;
let thirdUserSession;

const waitFor = (socket, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for " + event)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const waitForUserPresence = (socket, userID, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("userPresence", onPresence);
      reject(new Error("Timed out waiting for userPresence:" + userID));
    }, timeout);
    const onPresence = (payload) => {
      if (payload?.userID !== userID) return;
      clearTimeout(timer);
      socket.off("userPresence", onPresence);
      resolve(payload);
    };
    socket.on("userPresence", onPresence);
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
  [userSession, otherUserSession, thirdUserSession] = await SessionSchema.create([
    { user: user._id, device: "integration", ip: "127.0.0.1", userAgent: "integration-test" },
    { user: otherUser._id, device: "integration", ip: "127.0.0.1", userAgent: "integration-test" },
    { user: thirdUser._id, device: "integration", ip: "127.0.0.1", userAgent: "integration-test" },
  ]);

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
    await SessionSchema.deleteMany({ user: { $in: [user?._id, otherUser?._id, thirdUser?._id].filter(Boolean) } });
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
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
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
          { sub: uid.toString(), sv: 0, sid: (uid.toString() === user._id.toString() ? userSession : uid.toString() === otherUser._id.toString() ? otherUserSession : thirdUserSession)._id.toString(), scope: "socket" },
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
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
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
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
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
          { sub: uid.toString(), sv: 0, sid: (uid.toString() === user._id.toString() ? userSession : uid.toString() === otherUser._id.toString() ? otherUserSession : thirdUserSession)._id.toString(), scope: "socket" },
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
        { sub: thirdUser._id.toString(), sv: 0, sid: thirdUserSession._id.toString(), scope: "socket" },
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



test("multi-select state supports select, deselect, select all, prune deleted and rejects cross-room selection", () => {
  const roomA = "room-a";
  const roomB = "room-b";
  let state = enterMessageSelection(roomA, "m1");
  assert.deepEqual(state.selectedMessageIds, ["m1"]);
  state = toggleMessageSelection(state, roomA, "m2");
  assert.deepEqual(state.selectedMessageIds, ["m1", "m2"]);
  state = toggleMessageSelection(state, roomA, "m1");
  assert.deepEqual(state.selectedMessageIds, ["m2"]);

  const blocked = toggleMessageSelection(state, roomB, "m3");
  assert.deepEqual(blocked, state);

  state = selectAllMessages(roomA, ["m1", "m2", "m2", "m3"]);
  assert.deepEqual(state.selectedMessageIds, ["m1", "m2", "m3"]);

  state = pruneMessageSelection(state, roomA, ["m1", "m3"]);
  assert.deepEqual(state.selectedMessageIds, ["m1", "m3"]);

  state = pruneMessageSelection(state, roomA, []);
  assert.deepEqual(state, EMPTY_MESSAGE_SELECTION);
});

test("multi-select server actions cannot cross rooms", async () => {
  const sourceRoom = await RoomSchema.create({
    name: "Multi Select Source",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const otherRoom = await RoomSchema.create({
    name: "Multi Select Other",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });

  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");
    const message = await MessageSchema.create({
      sender: user._id,
      message: "multi-select source",
      roomID: sourceRoom._id,
      seen: [],
      hideFor: [],
    });

    socket.emit("pinMessage", message._id.toString(), otherRoom._id.toString(), false, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(Boolean((await MessageSchema.findById(message._id)).pinnedAt), false);

    const crossRoomForward = await new Promise((resolve) => {
      socket.emit(
        "forwardMessage",
        {
          msgID: message._id.toString(),
          sourceRoomID: otherRoom._id.toString(),
          targetRoomID: sourceRoom._id.toString(),
        },
        resolve,
      );
    });
    assert.equal(crossRoomForward.success, false);

    const crossRoomDelete = waitFor(socket, "error");
    socket.emit("deleteMsg", {
      forAll: true,
      msgID: message._id.toString(),
      roomID: otherRoom._id.toString(),
    });
    assert.equal((await crossRoomDelete).message, "Forbidden");
    assert.ok(await MessageSchema.exists({ _id: message._id }));

    const pinResult = await new Promise((resolve) => {
      socket.emit("pinMessage", message._id.toString(), sourceRoom._id.toString(), false, true, resolve);
    });
    assert.equal(pinResult.success, true);
    assert.ok((await MessageSchema.findById(message._id)).pinnedAt);

    const reactionResult = await new Promise((resolve) => {
      socket.emit("toggleReaction", {
        msgID: message._id.toString(),
        roomID: sourceRoom._id.toString(),
        emoji: "❤️",
      }, resolve);
    });
    assert.equal(reactionResult.success, true);
    const reacted = await MessageSchema.findById(message._id).lean();
    assert.ok(reacted.reactions.some((reaction) => reaction.emoji === "❤️" && reaction.userIds.map(String).includes(user._id.toString())));

    const forwardedExistsBefore = await MessageSchema.countDocuments({ roomID: otherRoom._id });
    const validForward = await new Promise((resolve) => {
      socket.emit("forwardMessage", {
        msgID: message._id.toString(),
        sourceRoomID: sourceRoom._id.toString(),
        targetRoomID: otherRoom._id.toString(),
      }, resolve);
    });
    assert.equal(validForward.success, true);
    assert.equal(await MessageSchema.countDocuments({ roomID: otherRoom._id }), forwardedExistsBefore + 1);

    socket.emit("deleteMsg", {
      forAll: true,
      msgID: message._id.toString(),
      roomID: sourceRoom._id.toString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await MessageSchema.exists({ _id: message._id }), null);
  } finally {
    socket.disconnect();
    await MessageSchema.deleteMany({ roomID: { $in: [sourceRoom._id, otherRoom._id] } });
    await RoomSchema.deleteMany({ _id: { $in: [sourceRoom._id, otherRoom._id] } });
  }
});

test("message search jump loads an older target with room authorization", async () => {
  const room = await RoomSchema.create({
    name: "Message Search Jump",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");
    const messages = await MessageSchema.create([
      { sender: user._id, message: "before target", roomID: room._id, seen: [], hideFor: [] },
      { sender: otherUser._id, message: "search target message", roomID: room._id, seen: [], hideFor: [] },
      { sender: user._id, message: "after target", roomID: room._id, seen: [], hideFor: [] },
    ]);

    const result = await new Promise((resolve) => {
      socket.emit(
        "loadMessageAround",
        { roomID: room._id.toString(), messageID: messages[1]._id.toString(), limit: 10 },
        resolve,
      );
    });

    assert.equal(result.success, true);
    assert.ok(result.messages.some((message) => message._id.toString() === messages[1]._id.toString()));
    assert.ok(result.messages.some((message) => message._id.toString() === messages[0]._id.toString()));
    assert.ok(result.messages.some((message) => message._id.toString() === messages[2]._id.toString()));

    const outsider = createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: thirdUser._id.toString(), sv: 0, sid: thirdUserSession._id.toString(), scope: "socket" },
          process.env.secretKey,
          { expiresIn: "5m" },
        ),
      },
      transports: ["websocket"],
    });
    try {
      await waitFor(outsider, "connect");
      const forbidden = await new Promise((resolve) => {
        outsider.emit(
          "loadMessageAround",
          { roomID: room._id.toString(), messageID: messages[1]._id.toString(), limit: 10 },
          resolve,
        );
      });
      assert.equal(forbidden.success, false);
      assert.equal(forbidden.error, "Forbidden");
    } finally {
      outsider.disconnect();
    }
  } finally {
    socket.disconnect();
    await MessageSchema.deleteMany({ roomID: room._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});

test("message search uses the dedicated text index and respects room visibility filters", async () => {
  const indexes = MessageSchema.schema.indexes();
  assert.ok(indexes.some(([fields]) => fields.message === "text"));

  const room = await RoomSchema.create({
    name: "Message Search Index",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const hiddenRoom = await RoomSchema.create({
    name: "Message Search Hidden Room",
    type: "group",
    creator: otherUser._id,
    admins: [otherUser._id],
    participants: [otherUser._id, thirdUser._id],
  });

  try {
    await MessageSchema.create([
      { sender: user._id, message: "unique search phrase alpha", roomID: room._id, seen: [], hideFor: [] },
      { sender: user._id, message: "unique search phrase hidden", roomID: room._id, seen: [], hideFor: [user._id] },
      { sender: otherUser._id, message: "unique search phrase foreign", roomID: hiddenRoom._id, seen: [], hideFor: [] },
    ]);

    const visible = await MessageSchema.find({
      $text: { $search: "unique search phrase" },
      roomID: room._id,
      hideFor: { $ne: user._id },
    }).lean();

    assert.equal(visible.length, 1);
    assert.equal(visible[0].message, "unique search phrase alpha");

    const senderFiltered = await MessageSchema.find({
      $text: { $search: "unique search phrase" },
      roomID: room._id,
      sender: otherUser._id,
      hideFor: { $ne: user._id },
    }).lean();
    assert.equal(senderFiltered.length, 0);

    const dateFiltered = await MessageSchema.find({
      $text: { $search: "unique search phrase" },
      roomID: room._id,
      createdAt: { $gte: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      hideFor: { $ne: user._id },
    }).lean();
    assert.equal(dateFiltered.length, 0);
  } finally {
    await MessageSchema.deleteMany({ roomID: { $in: [room._id, hiddenRoom._id] } });
    await RoomSchema.deleteMany({ _id: { $in: [room._id, hiddenRoom._id] } });
  }
});

test("bulk message delete removes selected messages in one operation and enforces authorization", async () => {
  const room = await RoomSchema.create({
    name: "Bulk Delete Integration",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const privateRoom = await RoomSchema.create({
    name: "Bulk Delete Private",
    type: "private",
    creator: user._id,
    admins: [user._id, otherUser._id],
    participants: [user._id, otherUser._id],
  });

  const makeSocket = (uid) =>
    createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: uid.toString(), sv: 0, sid: (uid.toString() === user._id.toString() ? userSession : uid.toString() === otherUser._id.toString() ? otherUserSession : thirdUserSession)._id.toString(), scope: "socket" },
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
    await Promise.all([
      join(socket, room._id.toString()),
      join(otherSocket, room._id.toString()),
    ]);

    const ownMessages = await MessageSchema.create([
      {
        sender: user._id,
        message: "bulk one",
        roomID: room._id,
        seen: [],
        hideFor: [],
      },
      {
        sender: user._id,
        message: "bulk two",
        roomID: room._id,
        seen: [],
        hideFor: [],
      },
    ]);

    const bulkEvent = waitFor(otherSocket, "messages:deleted");
    const result = await new Promise((resolve) => {
      socket.emit(
        "messages:delete",
        {
          roomID: room._id.toString(),
          messageIDs: ownMessages.map((message) => message._id.toString()),
          forAll: true,
        },
        resolve,
      );
    });

    assert.equal(result.success, true);
    assert.deepEqual(
      result.deletedIds.map(String).sort(),
      ownMessages.map((message) => message._id.toString()).sort(),
    );
    const broadcast = await bulkEvent;
    assert.deepEqual(broadcast.messageIDs.sort(), result.deletedIds.map(String).sort());
    assert.equal(await MessageSchema.countDocuments({ _id: { $in: ownMessages.map((message) => message._id) } }), 0);

    const foreignMessage = await MessageSchema.create({
      sender: otherUser._id,
      message: "foreign message",
      roomID: privateRoom._id,
      seen: [],
      hideFor: [],
    });

    const outsider = makeSocket(thirdUser._id);
    await waitFor(outsider, "connect");
    try {
      const nonMemberResult = await new Promise((resolve) => {
        outsider.emit(
          "messages:delete",
          {
            roomID: privateRoom._id.toString(),
            messageIDs: [foreignMessage._id.toString()],
            forAll: true,
          },
          resolve,
        );
      });
      assert.equal(nonMemberResult.success, false);
      assert.equal(nonMemberResult.error, "Forbidden");
    } finally {
      outsider.disconnect();
    }

    const forbidden = await new Promise((resolve) => {
      socket.emit(
        "messages:delete",
        {
          roomID: privateRoom._id.toString(),
          messageIDs: [foreignMessage._id.toString()],
          forAll: true,
        },
        resolve,
      );
    });

    assert.equal(forbidden.success, false);
    assert.equal(forbidden.error, "Forbidden");
    assert.ok(await MessageSchema.exists({ _id: foreignMessage._id }));

    const ownPrivate = await MessageSchema.create({
      sender: user._id,
      message: "own private message",
      roomID: privateRoom._id,
      seen: [],
      hideFor: [],
    });

    const deleteForMe = await new Promise((resolve) => {
      otherSocket.emit(
        "messages:delete",
        {
          roomID: privateRoom._id.toString(),
          messageIDs: [ownPrivate._id.toString()],
          forAll: false,
        },
        resolve,
      );
    });

    assert.equal(deleteForMe.success, true);
    const hidden = await MessageSchema.findById(ownPrivate._id).lean();
    assert.ok(hidden);
    assert.ok(hidden.hideFor.map(String).includes(otherUser._id.toString()));
  } finally {
    socket.disconnect();
    otherSocket.disconnect();
    await MessageSchema.deleteMany({ roomID: { $in: [room._id, privateRoom._id] } });
    await RoomSchema.deleteMany({ _id: { $in: [room._id, privateRoom._id] } });
  }
});

test("privacy permissions enforce everyone, contacts and nobody for every field", async () => {
  const room = await RoomSchema.create({
    name: "Privacy Integration",
    type: "private",
    creator: user._id,
    admins: [user._id, otherUser._id],
    participants: [user._id, otherUser._id],
  });

  const keys = ["lastSeen", "profilePhoto", "phone", "calls", "messages"];
  const makeSocket = (uid) =>
    createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: uid.toString(), sv: 0, sid: (uid.toString() === user._id.toString() ? userSession : uid.toString() === otherUser._id.toString() ? otherUserSession : thirdUserSession)._id.toString(), scope: "socket" },
          process.env.secretKey,
          { expiresIn: "5m" },
        ),
      },
      transports: ["websocket"],
    });

  const observer = makeSocket(user._id);
  const target = makeSocket(otherUser._id);

  try {
    await Promise.all([waitFor(observer, "connect"), waitFor(target, "connect")]);
    const targetJoin = waitFor(target, "joining");
    target.emit("joining", room._id.toString());
    await targetJoin;

    await UserSchema.updateOne(
      { _id: otherUser._id },
      {
        $set: {
          avatar: "/private-avatar.png",
          phone: "privacy-phone",
          privacySettings: {
            lastSeen: "everyone",
            profilePhoto: "everyone",
            phone: "everyone",
            calls: "everyone",
            messages: "everyone",
          },
        },
      },
    );

    for (const key of keys) {
      await UserSchema.updateOne({ _id: otherUser._id }, { $set: { ["privacySettings." + key]: "everyone" } });
      assert.equal(await canViewPrivacy(otherUser._id.toString(), user._id.toString(), key), true, key + ": everyone");
      assert.equal(await canViewPrivacy(otherUser._id.toString(), thirdUser._id.toString(), key), true, key + ": everyone for non-contact");

      await UserSchema.updateOne({ _id: otherUser._id }, { $set: { ["privacySettings." + key]: "contacts" } });
      assert.equal(await canViewPrivacy(otherUser._id.toString(), user._id.toString(), key), true, key + ": contacts for contact");
      assert.equal(await canViewPrivacy(otherUser._id.toString(), thirdUser._id.toString(), key), false, key + ": contacts for non-contact");

      await UserSchema.updateOne({ _id: otherUser._id }, { $set: { ["privacySettings." + key]: "nobody" } });
      assert.equal(await canViewPrivacy(otherUser._id.toString(), user._id.toString(), key), false, key + ": nobody");
      assert.equal(await canViewPrivacy(otherUser._id.toString(), thirdUser._id.toString(), key), false, key + ": nobody for non-contact");
    }

    await UserSchema.updateOne(
      { _id: otherUser._id },
      {
        $set: {
          "privacySettings.lastSeen": "nobody",
          "privacySettings.profilePhoto": "nobody",
          "privacySettings.phone": "nobody",
          "privacySettings.calls": "nobody",
          "privacySettings.messages": "nobody",
        },
      },
    );

    const hiddenPresencePromise = waitForUserPresence(observer, otherUser._id.toString());
    const hiddenOnlineListPromise = waitFor(observer, "updateOnlineUsers");
    const hiddenReconnect = makeSocket(otherUser._id);
    try {
      await waitFor(hiddenReconnect, "connect");
      const hiddenPresence = await hiddenPresencePromise;
      const hiddenOnlineList = await hiddenOnlineListPromise;
      assert.equal(hiddenPresence.status, "offline");
      assert.equal(hiddenPresence.lastSeenAt, null);
      assert.equal(hiddenOnlineList.some((entry) => entry.userID === otherUser._id.toString()), false);
    } finally {
      hiddenReconnect.disconnect();
    }

    const membersPromise = waitFor(observer, "getRoomMembers");
    observer.emit("getRoomMembers", { roomID: room._id.toString() });
    const hiddenMembers = await membersPromise;
    const hiddenTarget = hiddenMembers.find((member) => member._id === otherUser._id.toString());
    assert.equal(hiddenTarget.avatar, "");
    assert.equal(hiddenTarget.phone, undefined);

    const blockedMessage = await new Promise((resolve) => {
      observer.emit("newMessage", {
        roomID: room._id.toString(),
        message: "blocked by privacy",
        tempId: "privacy-blocked-" + Date.now(),
      }, resolve);
    });
    assert.equal(blockedMessage.success, false);
    assert.equal(blockedMessage.error, "Messages are restricted by this user");

    const blockedCall = await new Promise((resolve) => {
      observer.emit("call:invite", {
        callId: "11111111-1111-4111-8111-111111111111",
        roomID: room._id.toString(),
        targetUserID: otherUser._id.toString(),
        type: "audio",
      }, resolve);
    });
    assert.equal(blockedCall.success, false);
    assert.equal(blockedCall.error, "Calls are restricted by this user");

    await UserSchema.updateOne(
      { _id: otherUser._id },
      {
        $set: {
          "privacySettings.lastSeen": "everyone",
          "privacySettings.profilePhoto": "everyone",
          "privacySettings.phone": "everyone",
          "privacySettings.calls": "everyone",
          "privacySettings.messages": "everyone",
        },
      },
    );

    const visibleMembersPromise = waitFor(observer, "getRoomMembers");
    observer.emit("getRoomMembers", { roomID: room._id.toString() });
    const visibleMembers = await visibleMembersPromise;
    const visibleTarget = visibleMembers.find((member) => member._id === otherUser._id.toString());
    assert.equal(visibleTarget.avatar, "/private-avatar.png");
    assert.equal(visibleTarget.phone, "privacy-phone");

    const messagePromise = waitFor(target, "newMessage");
    const allowedMessage = await new Promise((resolve) => {
      observer.emit("newMessage", {
        roomID: room._id.toString(),
        message: "allowed by privacy",
        tempId: "privacy-allowed-" + Date.now(),
      }, resolve);
    });
    assert.equal(allowedMessage.success, true);
    await messagePromise;

    const incomingCallPromise = waitFor(target, "call:incoming");
    const allowedCall = await new Promise((resolve) => {
      observer.emit("call:invite", {
        callId: "22222222-2222-4222-8222-222222222222",
        roomID: room._id.toString(),
        targetUserID: otherUser._id.toString(),
        type: "audio",
      }, resolve);
    });
    assert.equal(allowedCall.success, true);
    await incomingCallPromise;
    target.emit("call:reject", { callId: "22222222-2222-4222-8222-222222222222" }, () => {});
  } finally {
    observer.disconnect();
    target.disconnect();
    await MessageSchema.deleteMany({ roomID: room._id });
    await RoomSchema.deleteOne({ _id: room._id });
    await UserSchema.updateOne(
      { _id: otherUser._id },
      {
        $set: {
          "privacySettings.lastSeen": "everyone",
          "privacySettings.profilePhoto": "everyone",
          "privacySettings.phone": "everyone",
          "privacySettings.calls": "everyone",
          "privacySettings.messages": "everyone",
        },
      },
    );
  }
});

test("last seen handles multi-socket presence and reconnects", async () => {
  const makeSocket = (uid) =>
    createClient("http://127.0.0.1:3101", {
      auth: {
        token: jwt.sign(
          { sub: uid.toString(), sv: 0, sid: (uid.toString() === user._id.toString() ? userSession : uid.toString() === otherUser._id.toString() ? otherUserSession : thirdUserSession)._id.toString(), scope: "socket" },
          process.env.secretKey,
          { expiresIn: "5m" },
        ),
      },
      transports: ["websocket"],
    });

  const observer = makeSocket(user._id);
  let targetA;
  let targetB;

  try {
    await waitFor(observer, "connect");
    const onlinePresence = waitForUserPresence(observer, otherUser._id.toString());

    targetA = makeSocket(otherUser._id);
    targetB = makeSocket(otherUser._id);
    await Promise.all([waitFor(targetA, "connect"), waitFor(targetB, "connect")]);
    const online = await onlinePresence;
    assert.equal(online.userID, otherUser._id.toString());
    assert.equal(online.status, "online");

    const onlineUser = await UserSchema.findById(otherUser._id).lean();
    assert.equal(onlineUser.status, "online");
    const previousLastSeenAt = onlineUser.lastSeenAt?.toISOString?.() ?? null;

    targetA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const stillOnline = await UserSchema.findById(otherUser._id).lean();
    assert.equal(stillOnline.status, "online");
    assert.equal(stillOnline.lastSeenAt?.toISOString?.() ?? null, previousLastSeenAt);

    const offlinePresence = waitForUserPresence(observer, otherUser._id.toString());
    targetB.disconnect();
    const offline = await offlinePresence;
    assert.equal(offline.userID, otherUser._id.toString());
    assert.equal(offline.status, "offline");
    assert.ok(offline.lastSeenAt);

    const lastSeenAt = offline.lastSeenAt;
    const offlineUser = await UserSchema.findById(otherUser._id).lean();
    assert.equal(offlineUser.status, "offline");
    assert.ok(offlineUser.lastSeenAt);

    const reconnectPresence = waitForUserPresence(observer, otherUser._id.toString());
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
    targetA?.disconnect();
    targetB?.disconnect();
    await UserSchema.updateOne(
      { _id: otherUser._id },
      { $set: { status: "offline" } },
    );
  }
});


test("attachment messages enforce verified-file ownership", async () => {
  const room = await RoomSchema.create({
    name: "Attachment Ownership",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const ownKey = `files/${user._id.toString()}/00000000-0000-4000-8000-000000000001`;
  const foreignKey = `files/${otherUser._id.toString()}/00000000-0000-4000-8000-000000000002`;
  await FileSchema.create([
    { key: ownKey, owner: user._id, contentType: "application/pdf" },
    { key: foreignKey, owner: otherUser._id, contentType: "application/pdf" },
  ]);
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign({ sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" }, process.env.secretKey, { expiresIn: "5m" }),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");
    await new Promise((resolve) => { socket.emit("joining", room._id.toString()); socket.once("joining", resolve); });

    const send = (attachmentData, tempId) =>
      new Promise((resolve) => socket.emit("newMessage", {
        roomID: room._id.toString(),
        message: "",
        attachmentData,
        tempId,
      }, resolve));

    const own = await send({
      src: `/api/files/access?key=${encodeURIComponent(ownKey)}`,
      name: "document.pdf",
      mimeType: "application/pdf",
      size: 1024,
    }, "attachment-own-" + Date.now());
    assert.equal(own.success, true);
    const saved = await MessageSchema.findById(own._id).lean();
    assert.equal(saved.attachmentData.name, "document.pdf");

    const foreign = await send({
      src: `/api/files/access?key=${encodeURIComponent(foreignKey)}`,
      name: "foreign.pdf",
      mimeType: "application/pdf",
      size: 1024,
    }, "attachment-foreign-" + Date.now());
    assert.equal(foreign.success, true);
    assert.equal((await MessageSchema.findById(foreign._id)).attachmentData, null);

    await MessageSchema.deleteMany({ roomID: room._id });
  } finally {
    socket.disconnect();
    await FileSchema.deleteMany({ key: { $in: [ownKey, foreignKey] } });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});


test("voice messages enforce verified-file ownership", async () => {
  const room = await RoomSchema.create({
    name: "Voice Ownership",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id, otherUser._id],
  });
  const ownKey = `voices/${user._id.toString()}/00000000-0000-4000-8000-000000000011`;
  const foreignKey = `voices/${otherUser._id.toString()}/00000000-0000-4000-8000-000000000012`;
  await FileSchema.create([
    { key: ownKey, owner: user._id, contentType: "audio/webm" },
    { key: foreignKey, owner: otherUser._id, contentType: "audio/webm" },
  ]);
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign({ sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" }, process.env.secretKey, { expiresIn: "5m" }),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");
    await new Promise((resolve) => { socket.emit("joining", room._id.toString()); socket.once("joining", resolve); });

    const send = (src, tempId) =>
      new Promise((resolve) => socket.emit("newMessage", {
        roomID: room._id.toString(),
        message: "",
        voiceData: { src, duration: 4, playedBy: [] },
        tempId,
      }, resolve));

    const own = await send(`/api/files/access?key=${encodeURIComponent(ownKey)}`, "voice-own-" + Date.now());
    assert.equal(own.success, true);
    assert.equal((await MessageSchema.findById(own._id).lean()).voiceData.src, `/api/files/access?key=${encodeURIComponent(ownKey)}`);

    const foreign = await send(`/api/files/access?key=${encodeURIComponent(foreignKey)}`, "voice-foreign-" + Date.now());
    assert.equal(foreign.success, true);
    assert.equal((await MessageSchema.findById(foreign._id).lean()).voiceData, null);
  } finally {
    socket.disconnect();
    await FileSchema.deleteMany({ key: { $in: [ownKey, foreignKey] } });
    await MessageSchema.deleteMany({ roomID: room._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});


test("sticker messages require an installed or owned pack and persist full sticker data", async () => {
  const room = await RoomSchema.create({
    name: "Sticker Integration",
    type: "private",
    creator: user._id,
    admins: [user._id, otherUser._id],
    participants: [user._id, otherUser._id],
  });
  const stickerKey = `stickers/${user._id.toString()}/00000000-0000-4000-8000-000000000021`;
  const pack = await StickerPackSchema.create({
    name: "integration_pack",
    title: "Integration Pack",
    owner: user._id,
    thumbnail: `/api/files/access?key=${encodeURIComponent(stickerKey)}`,
    stickers: [],
  });
  const sticker = await StickerSchema.create({
    packId: pack._id,
    file: `/api/files/access?key=${encodeURIComponent(stickerKey)}`,
    mimeType: "image/png",
    emoji: "🔥",
    sortOrder: 0,
  });
  pack.stickers = [sticker._id];
  await pack.save();
  await FileSchema.create({ key: stickerKey, owner: user._id, contentType: "image/png" });

  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign({ sub: otherUser._id.toString(), sv: 0, sid: otherUserSession._id.toString(), scope: "socket" }, process.env.secretKey, { expiresIn: "5m" }),
    },
    transports: ["websocket"],
  });

  try {
    await waitFor(socket, "connect");
    await new Promise((resolve) => { socket.emit("joining", room._id.toString()); socket.once("joining", resolve); });

    const denied = await new Promise((resolve) => socket.emit("newMessage", {
      roomID: room._id.toString(),
      message: "",
      stickerData: { stickerId: sticker._id.toString(), packId: pack._id.toString() },
      tempId: "sticker-denied-" + Date.now(),
    }, resolve));
    assert.equal(denied.success, false);
    assert.equal(denied.error, "Invalid sticker");

    await UserStickerPackSchema.create({ user: otherUser._id, packId: pack._id });
    const sent = await new Promise((resolve) => socket.emit("newMessage", {
      roomID: room._id.toString(),
      message: "",
      stickerData: { stickerId: sticker._id.toString(), packId: pack._id.toString() },
      tempId: "sticker-sent-" + Date.now(),
    }, resolve));
    assert.equal(sent.success, true);

    const saved = await MessageSchema.findById(sent._id).lean();
    assert.equal(String(saved.stickerData.stickerId), sticker._id.toString());
    assert.equal(String(saved.stickerData.packId), pack._id.toString());
    assert.equal(saved.stickerData.file, sticker.file);
    assert.equal(saved.stickerData.emoji, "🔥");
  } finally {
    socket.disconnect();
    await MessageSchema.deleteMany({ roomID: room._id });
    await UserStickerPackSchema.deleteMany({ packId: pack._id });
    await StickerSchema.deleteMany({ packId: pack._id });
    await StickerPackSchema.deleteOne({ _id: pack._id });
    await FileSchema.deleteOne({ key: stickerKey });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});


test("offline retry tempId is idempotent at the socket and database boundary", async () => {
  const room = await RoomSchema.create({
    name: "Offline Idempotency",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id],
  });
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });
  try {
    await waitFor(socket, "connect");
    const tempId = "offline-idempotent-" + Date.now();
    const send = () => new Promise((resolve) => socket.emit("newMessage", {
      roomID: room._id.toString(),
      message: "offline retry",
      tempId,
    }, resolve));
    const first = await send();
    const second = await send();
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second._id, first._id);
    assert.equal(await MessageSchema.countDocuments({ roomID: room._id, tempId: user._id.toString() + ":" + tempId }), 1);
  } finally {
    socket.disconnect();
    await MessageSchema.deleteMany({ roomID: room._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});

test("channel editor can forward through the same posting permission path", async () => {
  const sourceRoom = await RoomSchema.create({
    name: "Forward Source",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id],
  });
  const channel = await RoomSchema.create({
    name: "Forward Channel",
    type: "channel",
    creator: otherUser._id,
    admins: [otherUser._id],
    participants: [otherUser._id, user._id],
    channelRoles: { [user._id.toString()]: "editor" },
  });
  const socket = createClient("http://127.0.0.1:3101", {
    auth: {
      token: jwt.sign(
        { sub: user._id.toString(), sv: 0, sid: userSession._id.toString(), scope: "socket" },
        process.env.secretKey,
        { expiresIn: "5m" },
      ),
    },
    transports: ["websocket"],
  });
  try {
    await waitFor(socket, "connect");
    const source = await new Promise((resolve) => socket.emit("newMessage", {
      roomID: sourceRoom._id.toString(),
      message: "forwardable",
      tempId: "forward-source-" + Date.now(),
    }, resolve));
    assert.equal(source.success, true);

    const forwarded = await new Promise((resolve) => socket.emit("forwardMessage", {
      msgID: source._id,
      sourceRoomID: sourceRoom._id.toString(),
      targetRoomID: channel._id.toString(),
    }, resolve));
    assert.equal(forwarded.success, true);
    assert.equal(String(forwarded.message.roomID), channel._id.toString());
  } finally {
    socket.disconnect();
    await MessageSchema.deleteMany({ roomID: { $in: [sourceRoom._id, channel._id] } });
    await RoomSchema.deleteMany({ _id: { $in: [sourceRoom._id, channel._id] } });
  }
});


test("scheduled worker recovers a job when the message already exists", async () => {
  const room = await RoomSchema.create({
    name: "Scheduled Recovery",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id],
  });
  const scheduled = await ScheduledMessageSchema.create({
    sender: user._id,
    room: room._id,
    payload: { message: "already persisted" },
    scheduledFor: new Date(Date.now() - 1000),
    status: "processing",
    processingAt: new Date(Date.now() - 180000),
  });
  const tempId = "scheduled:" + scheduled._id.toString();
  await MessageSchema.create({
    sender: user._id,
    roomID: room._id,
    message: "already persisted",
    seen: [],
    hideFor: [],
    status: "sent",
    kind: "message",
    tempId,
    createdAt: Date.now(),
  });
  try {
    const deadline = Date.now() + 7000;
    let updated = null;
    while (Date.now() < deadline) {
      updated = await ScheduledMessageSchema.findById(scheduled._id).lean();
      if (updated?.status === "sent") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(updated?.status, "sent");
    assert.ok(updated?.sentAt);
    assert.equal(await MessageSchema.countDocuments({ roomID: room._id, tempId }), 1);
  } finally {
    await MessageSchema.deleteMany({ roomID: room._id });
    await ScheduledMessageSchema.deleteOne({ _id: scheduled._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});

test("scheduled message worker connects DB jobs to real messages", async () => {
  const room = await RoomSchema.create({
    name: "Scheduled Integration",
    type: "group",
    creator: user._id,
    admins: [user._id],
    participants: [user._id],
  });
  const scheduledFor = new Date(Date.now() + 250);
  const scheduled = await ScheduledMessageSchema.create({
    sender: user._id,
    room: room._id,
    payload: { message: "scheduled integration message" },
    scheduledFor,
  });
  try {
    const deadline = Date.now() + 9000;
    let message = null;
    while (Date.now() < deadline) {
      message = await MessageSchema.findOne({
        roomID: room._id,
        tempId: "scheduled:" + scheduled._id.toString(),
      }).lean();
      if (message) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(message, "scheduled worker did not create the message");
    assert.equal(message.message, "scheduled integration message");
    const updated = await ScheduledMessageSchema.findById(scheduled._id).lean();
    assert.equal(updated.status, "sent");
    assert.ok(updated.sentAt);
  } finally {
    await MessageSchema.deleteMany({ roomID: room._id });
    await ScheduledMessageSchema.deleteOne({ _id: scheduled._id });
    await RoomSchema.deleteOne({ _id: room._id });
  }
});
