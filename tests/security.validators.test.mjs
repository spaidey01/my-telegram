import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import RoomSchema from "../src/schemas/roomSchema.js";
import MessageSchema from "../src/schemas/messageSchema.js";
import DraftSchema from "../src/schemas/draftSchema.js";
import tokenDecoder from "../src/utils/TokenDecoder.js";
import jwt from "jsonwebtoken";

test("Mongo ObjectId validation rejects malformed identifiers",()=>{
  assert.equal(mongoose.isValidObjectId("abc"),false);
  assert.equal(mongoose.isValidObjectId("507f1f77bcf86cd799439011"),true);
});

test("room schema rejects invalid room types",()=>{
  const room=new RoomSchema({name:"x",type:"not-a-room",creator:new mongoose.Types.ObjectId(),participants:[]});
  assert.ok(room.validateSync()?.errors?.type);
});

test("message schema rejects missing required room/sender fields",()=>{
  const message=new MessageSchema({message:"hello"});
  const errors=message.validateSync()?.errors||{};
  assert.ok(errors.sender);
  assert.ok(errors.roomID);
});

test("message schema enforces message length",()=>{
  const message=new MessageSchema({
    sender:new mongoose.Types.ObjectId(),
    roomID:new mongoose.Types.ObjectId(),
    message:"x".repeat(10001),
  });
  assert.ok(message.validateSync()?.errors?.message);
});

test("draft schema enforces user/room ownership fields and message length", () => {
  const draft = new DraftSchema({ message: "x".repeat(10001) });
  const errors = draft.validateSync()?.errors || {};
  assert.ok(errors.user);
  assert.ok(errors.room);
  assert.ok(errors.message);
});

test("draft schema has a unique user-room index for one draft per room", () => {
  assert.ok(DraftSchema.schema.indexes().some(([fields, options]) =>
    fields.user === 1 && fields.room === 1 && options?.unique === true
  ));
});

test("scheduled message schema contains retry and lifecycle states", async () => {
  const { default: ScheduledSchema } = await import("../src/schemas/scheduledMessageSchema.js");
  assert.deepEqual(ScheduledSchema.schema.path("status").enumValues, ["pending", "processing", "sent", "failed", "cancelled"]);
  assert.ok(ScheduledSchema.schema.path("attemptCount"));
  assert.ok(ScheduledSchema.schema.path("processingAt"));
});


test("socket JWT expiry is enforced after connection", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.match(server, /socket\.userTokenExp/);
  assert.match(server, /Date\.now\(\) >= socket\.userTokenExp \* 1000/);
  assert.match(server, /socket\.disconnect\(true\)/);
});

test("socket-scoped JWTs are rejected by the REST token decoder", () => {
  process.env.secretKey = "integration-security-test-secret-0123456789";
  const socketToken = jwt.sign(
    { sub: new mongoose.Types.ObjectId().toString(), sv: 0, sid: new mongoose.Types.ObjectId().toString(), scope: "socket" },
    process.env.secretKey,
    { algorithm: "HS256", expiresIn: "5m" },
  );
  assert.equal(tokenDecoder(socketToken), false);
});


test("admin privileges require active room membership", async () => {
  const { isAdmin } = await import("../server/security/permissions.js");
  const admin = new mongoose.Types.ObjectId();
  const member = new mongoose.Types.ObjectId();
  const room = { creator: admin, participants: [admin, member], admins: [admin, member], type: "group" };
  assert.equal(isAdmin(room, admin.toString()), true);
  room.participants = [admin];
  assert.equal(isAdmin(room, member.toString()), false);
});


test("reaction update uses an atomic Mongo update pipeline", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  const start = server.indexOf('on("toggleReaction"');
  const end = server.indexOf('on("markRoomRead"', start);
  const handler = server.slice(start, end);
  assert.match(handler, /findOneAndUpdate/);
  assert.match(handler, /\$setUnion/);
  assert.doesNotMatch(handler, /msg\.reactions\s*=\s*reactions/);
  assert.doesNotMatch(handler, /await msg\.save\(\)/);
});


test("sticker file access requires pack ownership, installation, or a visible shared message", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/files/access/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /StickerPackSchema/);
  assert.match(source, /UserStickerPackSchema/);
  assert.match(source, /pack\.owner/);
  assert.match(source, /user:\s*userId\s*,\s*packId:\s*pack\._id/);
  assert.match(source, /stickerData\.file/);
  assert.match(source, /hideFor/);
  assert.doesNotMatch(source, /StickerSchema\.exists\(\{file:accessUrl\}\)/);
});
