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


test("reaction toggle is atomic for concurrent toggles by the same user", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  const start = server.indexOf('on("toggleReaction"');
  const end = server.indexOf('on("markRoomRead"', start);
  const handler = server.slice(start, end);
  assert.match(handler, /findOneAndUpdate/);
  assert.match(handler, /\$setUnion/);
  assert.match(handler, /\$in:\s*\[userObjectId, "\$\$reaction\.userIds"\]/);
  assert.match(handler, /\$filter/);
  assert.doesNotMatch(handler, /const alreadyReacted/);
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


test("presence and typing do not depend on node-local state", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(server, /const onlineUsers = new Map\(\)/);
  assert.doesNotMatch(server, /const typingByRoom = new Map\(\)/);
  assert.match(server, /io\.in\(presenceRoom\)\.fetchSockets\(\)/);
  assert.match(server, /io\.in\(data\.roomID\)\.fetchSockets\(\)/);
  assert.match(server, /io\.fetchSockets\(\)/);
});


test("room last message updates do not regress on delete-for-me or stale forward writes", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  const bulkDelete = server.slice(server.indexOf('on("messages:delete"'), server.indexOf('on("deleteMsg"'));
  assert.match(bulkDelete, /forAll\s*\?/);
  assert.match(bulkDelete, /lastMessageId:\s*\{\s*\$in:\s*ids\s*\}/);
  assert.doesNotMatch(bulkDelete, /hideFor:\s*\{\s*\$nin:\s*\[userID\]\s*\}\).*sort/);
  const forward = server.slice(server.indexOf('on("forwardMessage"'), server.indexOf('on("pinMessage"'));
  assert.match(forward, /lastMessageAt:\s*\{\s*\$lt:\s*forwarded\.createdAt\s*\}/);
  assert.match(forward, /lastMessageId:\s*\{\s*\$lt:\s*forwarded\._id\s*\}/);
});


test("private room creation uses a unique participant key to prevent duplicate races", async () => {
  const roomSchema = await (await import("node:fs/promises")).readFile(
    new URL("../src/schemas/roomSchema.js", import.meta.url),
    "utf8",
  );
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.match(roomSchema, /privateKey:\s*\{[^}]*unique:\s*true[^}]*sparse:\s*true/);
  const createRoom = server.slice(server.indexOf('on("createRoom"'), server.indexOf('on("joinRoom"'));
  assert.match(createRoom, /const privateKey = \[\.\.\.participants\]\.sort\(\)\.join\(":"\)/);
  assert.match(createRoom, /roomData\.privateKey = privateKey/);
  assert.match(createRoom, /error\?\.code !== 11000/);
  assert.match(createRoom, /findOne\(\{ type: "private", privateKey \}\)/);
});


test("2FA recovery codes are hashed at rest and consumed atomically", async () => {
  const route = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/auth/2fa/route.ts", import.meta.url),
    "utf8",
  );
  const totp = await (await import("node:fs/promises")).readFile(
    new URL("../src/utils/totp.ts", import.meta.url),
    "utf8",
  );
  const user = await (await import("node:fs/promises")).readFile(
    new URL("../src/schemas/userSchema.js", import.meta.url),
    "utf8",
  );
  assert.match(totp, /hashBackupCode/);
  assert.match(route, /codes\.map\(hashBackupCode\)/);
  assert.match(route, /twoFactorBackupCodes:hash/);
  assert.match(route, /\$pull:\{twoFactorBackupCodes:hash\}/);
  assert.match(route, /twoFactorBackupCodes:code/);
  assert.match(route, /\$map:\{input:"\$twoFactorBackupCodes"/);
  assert.match(user, /twoFactorBackupCodes: \{ type: \[String\], default: \[\], select: false \}/);
});


test("room updates use optimistic concurrency to reject stale writes", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  const start = server.indexOf('on("updateRoomData"');
  const end = server.indexOf('on("getRoomMembers"', start);
  const handler = server.slice(start, end);
  assert.match(handler, /\{ _id: roomID, __v: room\.\__v \?\? 0 \}/);
  assert.match(handler, /\{ \$set, \$inc: \{ __v: 1 \} \}/);
  assert.match(handler, /if \(!updatedRoom\)/);
  assert.match(handler, /Room changed; reload and try again/);
});

test("login consumes hashed 2FA recovery codes and migrates legacy plaintext codes", async () => {
  const route = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/auth/login/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /hashBackupCode/);
  assert.match(route, /twoFactorBackupCodes: recoveryHash/);
  assert.match(route, /\$pull: \{ twoFactorBackupCodes: recoveryHash \}/);
  assert.match(route, /twoFactorBackupCodes: recovery/);
  assert.match(route, /\$map:/);
  assert.doesNotMatch(route, /twoFactorBackupCodes\.includes\(recovery\)/);
});

test("admin authorization is centralized and socket call state fails closed on Redis errors", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.match(server, /import \{ GROUP_PERMISSION_KEYS, isAdmin, hasGroupPermission, channelCanPost \}/);
  assert.doesNotMatch(server, /const isAdmin = \(room, userID\)/);
  assert.match(server, /Redis call-state read failure:[\\s\\S]*?return null/);
  assert.match(server, /Redis call-state list failure:[\\s\\S]*?return \[\]/);
  assert.match(server, /effectiveTtl = ttlMs \?\? \(call\.acceptedAt \? CALL_ACTIVE_TTL_MS : CALL_RING_TIMEOUT_MS \+ CALL_RECONNECT_GRACE_MS\)/);
  assert.match(server, /CALL_ACTIVE_TTL_MS = 2 \* 60 \* 60 \* 1000/);
});

test("delete-for-all last message repair cannot overwrite a newer room message", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.match(
    server,
    /await RoomSchema\.updateOne\(\s*\{ _id: roomID, lastMessageId: msgID \}/,
  );
});

test("S3 presigned uploads use a pending prefix and verification only promotes pending objects", async () => {
  const presign = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/files/presign/route.ts", import.meta.url),
    "utf8",
  );
  const verify = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/files/verify/route.ts", import.meta.url),
    "utf8",
  );
  const cleanup = await (await import("node:fs/promises")).readFile(
    new URL("../server/storage/pendingUploads.js", import.meta.url),
    "utf8",
  );
  assert.match(presign, /pending\//);
  assert.match(verify, /const keyPattern/);
  assert.match(verify, /const verifiedPrefix/);
  assert.match(cleanup, /Prefix: PENDING_PREFIX/);
  assert.match(cleanup, /LastModified\.getTime\(\) < cutoff/);
  assert.match(cleanup, /DeleteObjectsCommand/);
  assert.doesNotMatch(cleanup, /!process\.env\.S3_ENDPOINT\) return 0/);
});

test("production file verification requires ClamAV", async () => {
  const verify = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/files/verify/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(verify, /process\.env\.NODE_ENV === "production" && !process\.env\.CLAMAV_HOST/);
  assert.match(verify, /if \(!host\) return reject\(new Error\("ClamAV host is not configured"\)\)/);
  assert.match(verify, /process\.env\.NODE_ENV === "production"\n\s*\? true/);
});


test("multi-device sessions are bound to sessionVersion and revoke-all invalidates the version", async () => {
  const session = await (await import("node:fs/promises")).readFile(
    new URL("../src/schemas/sessionSchema.js", import.meta.url),
    "utf8",
  );
  const login = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/auth/login/route.ts", import.meta.url),
    "utf8",
  );
  const sessions = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/auth/sessions/route.ts", import.meta.url),
    "utf8",
  );
  const logout = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/auth/logout/route.ts", import.meta.url),
    "utf8",
  );
  const currentUser = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/auth/currentuser/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(session, /sessionVersion: \{ type: Number, required: true, default: 0, index: true \}/);
  assert.match(login, /const sessionVersion = userData\.sessionVersion \?\? 0;/);
  assert.match(login, /SessionSchema\.create\(\{[\s\S]*user: userData\._id,[\s\S]*sessionVersion,/);
  assert.match(login, /tokenGenerator\(userData\._id\.toString\(\), 7, sessionVersion,/);
  assert.match(sessions, /sessionVersion:d\.sv,revokedAt:null/);
  assert.match(sessions, /user:d\.sub,sessionVersion:d\.sv,revokedAt:null/);
  assert.match(sessions, /\$inc:\{sessionVersion:1\}/);
  assert.match(currentUser, /sessionVersion: verifiedToken\.sv, revokedAt: null/);
  assert.match(logout, /sessionVersion: decoded\.sv, revokedAt: null/);
});


test("failure recovery policies fail closed for Redis, require ClamAV in production, and recover stale workers", async () => {
  const rateLimit = await (await import("node:fs/promises")).readFile(
    new URL("../src/utils/rateLimit.ts", import.meta.url),
    "utf8",
  );
  const verify = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/files/verify/route.ts", import.meta.url),
    "utf8",
  );
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.match(rateLimit, /Redis rate-limit connection failure/);
  assert.match(rateLimit, /redisPromise = null/);
  assert.match(rateLimit, /if \(!redis\?\.isOpen\)/);
  assert.match(rateLimit, /NODE_ENV === "production"/);
  assert.match(rateLimit, /return \{ allowed: false/);
  assert.match(verify, /NODE_ENV === "production" && !process\.env\.CLAMAV_HOST/);
  assert.doesNotMatch(verify, /!process\.env\.S3_ENDPOINT/);
  assert.match(server, /status: "processing", processingAt: \{ \$lte: staleBefore \}/);
  assert.match(server, /status: "pending", processingAt: null/);
  assert.match(server, /MAX_SCHEDULED_ATTEMPTS = 5/);
});


test("Admin mutations require active room membership and proxy IP headers are opt-in", async () => {
  const server = read("server/index.js");
  const rateLimit = read("src/utils/rateLimit.ts");
  assert.match(server, /const room = await isMember\(roomID, userID\);\s*if \(!room \|\| !isAdmin\(room, userID\)/);
  assert.match(rateLimit, /TRUSTED_PROXY_COUNT \?\? "0"/);
  assert.match(rateLimit, /if \(n > 0 && forwarded\)/);
  assert.match(rateLimit, /if \(n > 0\) \{/);
});

test("Socket.IO flood protection rate-limits handshakes, rejects malicious Origins, and caps in-flight handlers", async () => {
  const server = await (await import("node:fs/promises")).readFile(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  assert.match(server, /origin === "null" || (origin && !allowedOrigins.includes(origin))/);
  assert.match(server, /allowEvent\("handshake:" \+ address, "__connect__", SOCKET_HANDSHAKE_IP_LIMIT, 60_000\)/);
  assert.match(server, /SOCKET_HANDSHAKE_USER_LIMIT = Math.max\(30, Number\(process\.env\.SOCKET_HANDSHAKE_USER_LIMIT\) \|\| 30\)/);
  assert.match(server, /allowEvent\("handshake-user:" + decoded\.sub, "__connect__", SOCKET_HANDSHAKE_USER_LIMIT, 60_000\)/);
  assert.match(server, /const MAX_SOCKET_IN_FLIGHT = 100/);
  assert.match(server, /const SOCKET_BURST_LIMIT = 120/);
  assert.match(server, /allowEvent("socket:" + socket.id, "__all__", SOCKET_BURST_LIMIT, SOCKET_BURST_WINDOW_MS)/);
  assert.match(server, /if (inFlightHandlers >= MAX_SOCKET_IN_FLIGHT)/);
  assert.match(server, /Rate limit exceeded/);
  assert.match(server, /finally \{\s*inFlightHandlers -= 1;/);
  assert.match(server, /origin: (origin, callback) =>/);
  assert.match(server, /allowedOrigins.includes(origin)/);
});
