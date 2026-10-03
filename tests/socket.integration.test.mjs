import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { io as createClient } from "socket.io-client";
import mongoose from "mongoose";
import { socketTokenGenerator } from "../src/utils/TokenGenerator.js";
import UserSchema from "../src/schemas/userSchema.js";
import RoomSchema from "../src/schemas/roomSchema.js";

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/my_telegram_test";
process.env.secretKey ||= "integration-test-secret";
process.env.SOCKET_PORT ||= "3101";
process.env.CLIENT_ORIGIN ||= "http://localhost:3000";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";

let server;
let user;

const waitFor = (socket, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for " + event)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

before(async () => {
  const serverModule = await import("../server/index.js");
  server = serverModule.io;
  user = await UserSchema.create({
    name: "integration",
    username: "integration_" + Date.now(),
    phone: "integration_" + Date.now(),
    password: "not-a-real-password",
    sessionVersion: 0,
  });
});

after(async () => {
  if (user) await UserSchema.deleteOne({ _id: user._id });
  await RoomSchema.deleteMany({ creator: user?._id });
  await mongoose.disconnect();
  await new Promise((resolve) => server?.close(resolve));
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
    auth: { token: socketTokenGenerator(user._id.toString(), 0) },
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
