import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import RoomSchema from "../src/schemas/roomSchema.js";
import MessageSchema from "../src/schemas/messageSchema.js";
import MediaSchema from "../src/schemas/mediaSchema.js";
import LocationSchema from "../src/schemas/locationSchema.js";
import UserSchema from "../src/schemas/userSchema.js";
import FileSchema from "../src/schemas/fileSchema.js";
import connectToDB from "../src/db/index.js";

const secret = process.env.secretKey;
if (!secret) throw new Error("secretKey is not configured");

const allowedOrigins = (process.env.CLIENT_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  .split(",").map((v) => v.trim()).filter(Boolean);

const socketPort = Number(process.env.SOCKET_PORT || process.env.PORT || 3001);
const redisUrl = process.env.REDIS_URL;
let redisAdapter;
let redisPubClient;
let redisSubClient;
let redisRateClient;

if (redisUrl) {
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();
  redisPubClient = pubClient;
  redisSubClient = subClient;
  redisRateClient = createClient({ url: redisUrl });
  pubClient.on("error", (error) => console.error("Redis pub client error:", error));
  subClient.on("error", (error) => console.error("Redis sub client error:", error));
  redisRateClient.on("error", (error) => console.error("Redis rate-limit client error:", error));
  await Promise.all([pubClient.connect(), subClient.connect(), redisRateClient.connect()]);
  redisAdapter = createAdapter(pubClient, subClient);
} else if (process.env.NODE_ENV === "production") {
  throw new Error("REDIS_URL is required in production for distributed Socket.IO");
}

const io = new Server({
  ...(redisAdapter ? { adapter: redisAdapter } : {}),
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
  },
  pingTimeout: 30000,
  ...(redisAdapter ? {} : {
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
  }),
});

io.listen(socketPort);
console.log(`Socket server is running on port ${socketPort}`);

export const shutdown = async () => {
  await new Promise((resolve) => io.close(resolve));
  await Promise.all(
    [redisPubClient, redisSubClient, redisRateClient]
      .filter((client) => client?.isOpen)
      .map((client) => client.close().catch(() => {})),
  );
};

export { io };

const onlineUsers = new Map();
const typingByRoom = new Map();
const activeCalls = new Map();
const eventBuckets = new Map();
const MAX_EVENT_BUCKETS = 50_000;

const allowEvent = async (userID, event, limit, windowMs) => {
  if (redisUrl) {
    try {
      const result = await redisRateClient.eval(`
        local count = redis.call("INCR", KEYS[1])
        if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[2]) end
        return count
      `, {
        keys: [`socket-rate-limit:${userID}:${event}`],
        arguments: [String(limit), String(windowMs)],
      });
      return Number(result) <= limit;
    } catch (error) {
      console.error("Redis socket rate-limit failure:", error);
      return false;
    }
  }

  if (process.env.NODE_ENV === "production") return false;
  const key = userID + ":" + event;
  const now = Date.now();
  const bucket = eventBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (eventBuckets.size >= MAX_EVENT_BUCKETS) cleanupEventBuckets();
    if (eventBuckets.size >= MAX_EVENT_BUCKETS) return false;
    eventBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
};

const cleanupEventBuckets = () => {
  const now = Date.now();
  for (const [key, bucket] of eventBuckets) {
    if (bucket.resetAt <= now) eventBuckets.delete(key);
  }
};
setInterval(cleanupEventBuckets, 60_000).unref();

const FILE_URL_RE = /^\/api\/files\/access\?key=(images|voices|files)%2F([a-fA-F0-9]{24})%2F([0-9a-f-]{36})$/;

// Returns true only if `url` is an access URL for a file that (a) belongs to `userID`,
// (b) has the expected prefix and (c) passed /api/files/verify.
const isOwnVerifiedFile = async (url, userID, prefix) => {
  if (typeof url !== "string" || url.length > 300) return false;
  const match = FILE_URL_RE.exec(url);
  if (!match || match[1] !== prefix || match[2] !== userID) return false;
  const key = `${match[1]}/${match[2]}/${match[3]}`;
  return Boolean(await FileSchema.exists({ key, owner: userID }));
};

// Avatars: empty, unchanged legacy value, or an own verified image.
const isAllowedAvatar = async (value, userID, currentValue) => {
  if (typeof value !== "string") return false;
  if (value === "" || value === currentValue) return true;
  return isOwnVerifiedFile(value, userID, "images");
};

const sanitizeVoiceData = async (voiceData, userID) => {
  if (voiceData == null) return null;
  if (typeof voiceData !== "object") return null;
  const src = typeof voiceData.src === "string" ? voiceData.src.trim() : "";
  const duration = Number(voiceData.duration);
  if (!src || !Number.isFinite(duration) || duration < 0 || duration > 3600) return null;
  if (!(await isOwnVerifiedFile(src, userID, "voices"))) return null;
  return { src, duration, playedBy: [] };
};
const sanitizeAttachmentData = async (data, userID) => {
  if (!data || typeof data !== "object") return null;
  const src = typeof data.src === "string" ? data.src.trim() : "";
  const name = typeof data.name === "string" ? data.name.trim().slice(0,255) : "";
  const mimeType = typeof data.mimeType === "string" ? data.mimeType.trim().slice(0,120).toLowerCase() : "";
  const size = Number(data.size);
  const prefix = mimeType.startsWith("image/") ? "images" : mimeType.startsWith("audio/") ? "voices" : "files";
  if (!src || !name || !mimeType || !Number.isFinite(size) || size < 1 || size > 25*1024*1024) return null;
  if (!(await isOwnVerifiedFile(src, userID, prefix))) return null;
  return { src, name, mimeType, size };
};
const sanitizeStickerData = (data) => {
  if (!data || typeof data !== "object" || typeof data.emoji !== "string") return null;
  const emoji = data.emoji.trim();
  return emoji && emoji.length <= 16 ? { emoji } : null;
};

await connectToDB();

const getUserId = (socket) => socket.userId;

const isValidId = (value) => typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);

const isMember = async (roomID, userID) => {
  if (!isValidId(roomID) || !isValidId(userID)) return null;
  return RoomSchema.findOne({ _id: roomID, participants: userID });
};

const isAdmin = (room, userID) =>
  !!room && (room.creator?.toString() === userID || room.admins?.some((id) => id.toString() === userID));

const isMessageInRoom = async (msgID, roomID) => {
  if (!isValidId(msgID) || !isValidId(roomID)) return null;
  return MessageSchema.findOne({ _id: msgID, roomID });
};

const publicUserFields = "name username avatar _id";
const findLatestVisibleMessage = (roomID) =>
  MessageSchema.findOne({ roomID }).sort({ createdAt: -1, _id: -1 }).lean();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded !== "object" || decoded.scope !== "socket" || !decoded.sub || typeof decoded.sv !== "number") {
      return next(new Error("Unauthorized"));
    }
    const user = await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id sessionVersion").lean();
    if (!user) return next(new Error("Unauthorized"));
    socket.userId = decoded.sub.toString();
    socket.sessionVersion = decoded.sv;
    socket.userTokenExp = decoded.exp;
    return next();
  } catch {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userID = getUserId(socket);
  const publicUserPromise = UserSchema.findById(userID).select("name username avatar _id").lean();
  onlineUsers.set(userID, (onlineUsers.get(userID) || new Set()).add(socket.id));

  const broadcastOnlineUsers = () => {
    const ids = [...onlineUsers.keys()].map((userID) => ({ userID }));
    io.emit("updateOnlineUsers", ids);
  };
  broadcastOnlineUsers();

  const tokenExpiryMs = socket.userTokenExp ? socket.userTokenExp * 1000 - Date.now() : 0;
  if (tokenExpiryMs > 0) {
    setTimeout(() => socket.disconnect(true), tokenExpiryMs);
  }

  // Wrap every handler so a thrown error never becomes an unhandled rejection
  // and the client always gets an answer.
  const on = (event, handler) => socket.on(event, async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(event + ":", error);
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb({ success: false, error: "Internal error" });
      else socket.emit("error", { message: "Internal error" });
    }
  });

  on("newMessage", async ({ roomID, message, replayData, voiceData = null, attachmentData = null, stickerData = null, tempId }, callback = () => {}) => {
    if (!(await allowEvent(userID, "newMessage", 30, 60_000))) return callback({ success: false, error: "Rate limit exceeded" });
    try {
      const room = await isMember(roomID, userID);
      if (!room) return callback({ success: false, error: "Forbidden" });
      if (room.type === "channel" && !isAdmin(room, userID)) return callback({ success: false, error: "Forbidden" });
      if (typeof message !== "string" || message.length > 10000) return callback({ success: false, error: "Invalid message" });

      let scopedTempId;
      if (tempId !== undefined && tempId !== null) {
        if (typeof tempId !== "string" || tempId.length > 200) return callback({ success: false, error: "Invalid tempId" });
        scopedTempId = userID + ":" + tempId;
        const existing = await MessageSchema.findOne({ tempId: scopedTempId }).lean();
        if (existing) return callback({ success: true, _id: existing._id });
      }

      const msgData = {
        sender: userID,
        message,
        roomID,
        seen: [],
        voiceData: await sanitizeVoiceData(voiceData, userID),
        attachmentData: await sanitizeAttachmentData(attachmentData, userID),
        stickerData: sanitizeStickerData(stickerData),
        createdAt: Date.now(),
        tempId: scopedTempId,
        status: "sent",
      };

      const newMsg = await MessageSchema.create(msgData);

      if (isValidId(replayData?.targetID)) {
        const target = await MessageSchema.findOne({ _id: replayData.targetID, roomID })
          .populate("sender", "username")
          .exec();
        if (target) {
          await MessageSchema.updateOne({ _id: target._id }, { $push: { replays: newMsg._id } });
          newMsg.replayedTo = {
            message: typeof target.message === "string" ? target.message : "",
            msgID: target._id.toString(),
            username: typeof target.sender?.username === "string" ? target.sender.username : "",
          };
          await newMsg.save();
        }
      }

      await RoomSchema.updateOne(
        { _id: roomID },
        { $set: { lastMessageId: newMsg._id, lastMessageAt: newMsg.createdAt } },
      );

      const populatedMsg = await MessageSchema.findById(newMsg._id)
        .populate("sender", "name username avatar _id")
        .lean();

      socket.to(roomID).emit("newMessage", populatedMsg);
      socket.emit("newMessageIdUpdate", { tempId, _id: newMsg._id });
      io.to(roomID).emit("lastMsgUpdate", populatedMsg);
      io.to(roomID).emit("updateLastMsgData", { msgData: populatedMsg, roomID });
      callback({ success: true, _id: newMsg._id });
    } catch (error) {
      console.error("newMessage:", error);
      callback({ success: false, error: "Unable to send message" });
    }
  });

  on("createRoom", async ({ newRoomData, message = null }) => {
    if (!(await allowEvent(userID, "createRoom", 10, 60_000))) return;
    try {
      if (!newRoomData || !["private", "group", "channel"].includes(newRoomData.type)) return;
      const requestedParticipants = Array.isArray(newRoomData.participants)
        ? newRoomData.participants
            .map((p) => (typeof p === "string" ? p : p?._id))
            .filter(isValidId)
        : [];
      const uniqueRequestedParticipants = [...new Set([userID, ...requestedParticipants])].slice(0, 500);
      const existingUsers = await UserSchema.find({ _id: { $in: uniqueRequestedParticipants } }).select("_id").lean();
      const existingUserIds = new Set(existingUsers.map((u) => u._id.toString()));
      const participants = uniqueRequestedParticipants.filter((id) => existingUserIds.has(id));

      if (newRoomData.type === "private" && participants.length !== 2) return;
      if (newRoomData.link !== undefined && newRoomData.link !== null && newRoomData.link !== "" && (
        typeof newRoomData.link !== "string" || !/^@[a-f0-9]{20}$/.test(newRoomData.link.trim().toLowerCase())
      )) return;

      const roomData = {
        name: typeof newRoomData.name === "string" ? newRoomData.name.trim().slice(0, 100) : "New Room",
        avatar: (await isAllowedAvatar(newRoomData.avatar ?? "", userID, "")) ? (newRoomData.avatar ?? "") : "",
        type: newRoomData.type,
        creator: userID,
        admins: [userID],
        participants,
        link: typeof newRoomData.link === "string" && /^@[a-f0-9]{20}$/.test(newRoomData.link.trim())
          ? newRoomData.link.trim().toLowerCase()
          : undefined,
        biography: typeof newRoomData.biography === "string" ? newRoomData.biography.slice(0, 1000) : undefined,
      };

      if (newRoomData.type === "private") {
        const existing = await RoomSchema.findOne({ type: "private", participants: { $all: participants, $size: 2 } });
        if (existing) {
          socket.emit("createRoom", existing);
          return;
        }
      }

      const newRoom = await RoomSchema.create(roomData);

      if (message && typeof message.message === "string") {
        const newMsg = await MessageSchema.create({
          sender: userID,
          message: message.message.slice(0, 10000),
          roomID: newRoom._id,
          seen: [],
          voiceData: await sanitizeVoiceData(message.voiceData, userID),
          attachmentData: await sanitizeAttachmentData(message.attachmentData, userID),
          stickerData: sanitizeStickerData(message.stickerData),
          status: "sent",
        });
        newRoom.lastMessageId = newMsg._id;
        newRoom.lastMessageAt = newMsg.createdAt;
        await newRoom.save();
      }

      for (const memberID of participants) {
        for (const socketID of onlineUsers.get(memberID) || []) io.sockets.sockets.get(socketID)?.join(newRoom._id.toString());
      }
      io.to(newRoom._id.toString()).emit("createRoom", newRoom);
    } catch (error) {
      console.error("createRoom:", error);
    }
  });

  on("joinRoom", async ({ roomID, link }) => {
    if (!(await allowEvent(userID, "joinRoom", 20, 60_000))) return;
    try {
      if (!isValidId(roomID) || typeof link !== "string" || link.length > 500) return;
      const room = await RoomSchema.findOne({ _id: roomID, link: link.trim() });
      if (!room || room.type === "private" || !room.link) {
        socket.emit("joinRoomError", { message: "This room is not publicly joinable" });
        return;
      }
      if (!room.participants.some((id) => id.toString() === userID)) {
        room.participants.push(userID);
        await room.save();
      }
      socket.join(roomID);
      io.to(roomID).emit("joinRoom", { userID, roomID });
    } catch (error) {
      console.error("joinRoom:", error);
    }
  });

  on("deleteRoom", async (roomID) => {
    if (!(await allowEvent(userID, "deleteRoom", 10, 60_000))) return;
    if (!isValidId(roomID)) return socket.emit("error", { message: "Invalid room" });
    const room = await RoomSchema.findById(roomID);
    if (!room || !isAdmin(room, userID) || room.type === "private") return socket.emit("error", { message: "Forbidden" });
    io.to(roomID).emit("deleteRoom", roomID);
    io.to(roomID).emit("updateLastMsgData", { msgData: null, roomID });
    await Promise.all([
      RoomSchema.deleteOne({ _id: roomID }),
      MessageSchema.deleteMany({ roomID }),
      MediaSchema.deleteMany({ roomID }),
      LocationSchema.deleteMany({ roomID }),
    ]);
  });

  on("deleteMsg", async ({ forAll, msgID, roomID }) => {
    if (!(await allowEvent(userID, "deleteMsg", 60, 60_000))) return;
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg) return socket.emit("error", { message: "Forbidden" });

    if (forAll) {
      if (msg.sender.toString() !== userID && (room.type === "private" || !isAdmin(room, userID))) return socket.emit("error", { message: "Forbidden" });
      await MessageSchema.deleteOne({ _id: msgID });
      const replacementLast = await findLatestVisibleMessage(roomID);
      await RoomSchema.updateOne(
        { _id: roomID },
        { $set: { lastMessageId: replacementLast?._id || null, lastMessageAt: replacementLast?.createdAt || null } },
      );
      io.to(roomID).emit("deleteMsg", msgID);
    } else {
      await MessageSchema.updateOne({ _id: msgID }, { $addToSet: { hideFor: userID } });
      socket.emit("deleteMsg", msgID);
    }

    const lastMsg = await MessageSchema.findOne({ roomID, hideFor: { $nin: [userID] } }).sort({ createdAt: -1, _id: -1 }).lean();
    if (forAll) {
      io.to(roomID).emit("updateLastMsgData", { msgData: lastMsg || null, roomID });
    } else {
      socket.emit("updateLastMsgData", { msgData: lastMsg || null, roomID });
    }
  });

  on("editMessage", async ({ msgID, editedMsg, roomID }) => {
    if (!(await allowEvent(userID, "editMessage", 60, 60_000))) return;
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg || msg.sender.toString() !== userID || typeof editedMsg !== "string" || editedMsg.length > 10000) return socket.emit("error", { message: "Forbidden" });

    const updated = await MessageSchema.findOneAndUpdate({ _id: msgID, roomID, sender: userID }, { message: editedMsg, isEdited: true }, { new: true }).lean();
    if (!updated) return;
    io.to(roomID).emit("editMessage", { msgID, editedMsg, roomID });
    const lastMsg = await MessageSchema.findOne({ roomID }).sort({ createdAt: -1 }).lean();
    if (lastMsg?._id.toString() === msgID) io.to(roomID).emit("updateLastMsgData", { roomID, msgData: updated });
  });

  on("seenMsg", async ({ msgID, roomID, readTime }) => {
    if (!(await allowEvent(userID, "seenMsg", 120, 60_000))) return;
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg) return;
    const safeReadTime = new Date();
    await MessageSchema.updateOne({ _id: msgID }, { $addToSet: { seen: userID }, $set: { readTime: safeReadTime } });
    io.to(roomID).emit("seenMsg", { msgID, roomID, seenBy: userID, readTime: safeReadTime });
  });

  on("listenToVoice", async ({ voiceID, roomID }) => {
    if (!(await allowEvent(userID, "listenToVoice", 60, 60_000))) return;
    const room = await isMember(roomID, userID);
    const targetMessage = await isMessageInRoom(voiceID, roomID);
    if (!room || !targetMessage?.voiceData) return;
    const playedBy = targetMessage.voiceData.playedBy || [];
    if (!playedBy.some((v) => v === userID || v.startsWith(userID + "_"))) {
      await MessageSchema.updateOne({ _id: voiceID }, { $addToSet: { "voiceData.playedBy": userID } });
    }
    io.to(roomID).emit("listenToVoice", { userID, voiceID, roomID });
  });

  on("getVoiceMessageListeners", async (msgID) => {
    if (!(await allowEvent(userID, "getVoiceMessageListeners", 30, 60_000)) || !isValidId(msgID)) return;
    const targetMessage = await MessageSchema.findById(msgID);
    if (!targetMessage) return;
    const room = await isMember(targetMessage.roomID, userID);
    if (!room) return;
    const playedBy = targetMessage.voiceData?.playedBy || [];
    const ids = [...new Set(playedBy.map((v) => v.split("_")[0]))];
    const users = await UserSchema.find({ _id: { $in: ids } })
      .select("name lastName username avatar biography type status _id")
      .lean();
    socket.emit("getVoiceMessageListeners", users.map((data) => ({
      ...data,
      seenTime: playedBy.find((v) => v.startsWith(data._id.toString() + "_"))?.split("_").slice(1).join("_") || null,
    })));
  });

  on("call:invite", async ({ callId, roomID, targetUserID, type }, callback = () => {}) => {
    if (!(await allowEvent(userID, "call:invite", 10, 60000))) return callback({ success:false, error:"Rate limit exceeded" });
    if (!isValidId(roomID) || !isValidId(targetUserID) || !["audio","video"].includes(type) || typeof callId !== "string") return callback({success:false,error:"Invalid call"});
    const room=await isMember(roomID,userID);
    if(!room || room.type!=="private" || !(await isMember(roomID,targetUserID))) return callback({success:false,error:"Forbidden"});
    if([...activeCalls.values()].some(c=>c.caller===targetUserID||c.callee===targetUserID)) return callback({success:false,error:"User is busy"});
    const caller=await UserSchema.findById(userID).select("name username avatar _id").lean();
    activeCalls.set(callId,{caller:userID,callee:targetUserID,roomID,type,createdAt:Date.now()});
    for(const sid of onlineUsers.get(targetUserID)||[]) io.sockets.sockets.get(sid)?.emit("call:incoming",{callId,roomID,type,from:caller});
    callback({success:true});
  });
  on("call:accept",async({callId})=>{const c=activeCalls.get(callId);if(!c||c.callee!==userID)return;for(const sid of onlineUsers.get(c.caller)||[])io.sockets.sockets.get(sid)?.emit("call:accepted",{callId,roomID:c.roomID,type:c.type});});
  on("call:reject",async({callId,reason="rejected"})=>{const c=activeCalls.get(callId);if(!c||(c.caller!==userID&&c.callee!==userID))return;const target=c.caller===userID?c.callee:c.caller;for(const sid of onlineUsers.get(target)||[])io.sockets.sockets.get(sid)?.emit("call:rejected",{callId,reason});activeCalls.delete(callId);});
  on("call:offer",async({callId,description})=>{const c=activeCalls.get(callId);if(!c||c.caller!==userID||!description?.sdp)return;for(const sid of onlineUsers.get(c.callee)||[])io.sockets.sockets.get(sid)?.emit("call:offer",{callId,description});});
  on("call:answer",async({callId,description})=>{const c=activeCalls.get(callId);if(!c||c.callee!==userID||!description?.sdp)return;for(const sid of onlineUsers.get(c.caller)||[])io.sockets.sockets.get(sid)?.emit("call:answer",{callId,description});});
  on("call:ice",async({callId,candidate})=>{const c=activeCalls.get(callId);if(!c||(c.caller!==userID&&c.callee!==userID)||!candidate)return;const target=c.caller===userID?c.callee:c.caller;for(const sid of onlineUsers.get(target)||[])io.sockets.sockets.get(sid)?.emit("call:ice",{callId,candidate});});
  on("call:end",async({callId})=>{const c=activeCalls.get(callId);if(!c||(c.caller!==userID&&c.callee!==userID))return;const target=c.caller===userID?c.callee:c.caller;for(const sid of onlineUsers.get(target)||[])io.sockets.sockets.get(sid)?.emit("call:ended",{callId});activeCalls.delete(callId);});
  on("getRooms", async () => {
    if (!(await allowEvent(userID, "getRooms", 20, 60_000))) return;

    const rawRooms = await RoomSchema.find({ participants: userID })
      .select("_id name avatar type participants admins creator link biography lastMessageId lastMessageAt createdAt updatedAt")
      .sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 })
      .limit(500)
      .lean();

    const participantIds = [...new Set(
      rawRooms
        .filter((room) => room.type === "private")
        .flatMap((room) => room.participants.map((id) => id.toString())),
    )];

    const privateUsers = participantIds.length
      ? await UserSchema.find({ _id: { $in: participantIds } }).select("name username avatar _id").lean()
      : [];
    const usersById = new Map(privateUsers.map((user) => [user._id.toString(), user]));

    const latestMessages = rawRooms.length
      ? await MessageSchema.aggregate([
          { $match: {
              roomID: { $in: rawRooms.map((room) => room._id) },
              hideFor: { $nin: [new mongoose.Types.ObjectId(userID)] },
            } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $group: { _id: "$roomID", message: { $first: "$$ROOT" } } },
        ])
      : [];

    const latestMessageDocs = latestMessages.map((item) => item.message);
    const senderIds = [...new Set(latestMessageDocs.map((message) => message.sender?.toString()).filter(Boolean))];
    const senderUsers = senderIds.length
      ? await UserSchema.find({ _id: { $in: senderIds } }).select("name username avatar _id").lean()
      : [];
    const senderById = new Map(senderUsers.map((user) => [user._id.toString(), user]));
    const lastMessagesByRoom = new Map(
      latestMessageDocs.map((message) => [
        message.roomID.toString(),
        { ...message, sender: senderById.get(message.sender?.toString()) || message.sender },
      ]),
    );

    const unreadCounts = await MessageSchema.aggregate([
      {
        $match: {
          roomID: { $in: rawRooms.map((room) => room._id) },
          sender: { $ne: new mongoose.Types.ObjectId(userID) },
          seen: { $nin: [new mongoose.Types.ObjectId(userID)] },
          hideFor: { $nin: [new mongoose.Types.ObjectId(userID)] },
        },
      },
      { $group: { _id: "$roomID", count: { $sum: 1 } } },
    ]);
    const unreadByRoom = new Map(unreadCounts.map((item) => [item._id.toString(), item.count]));

    const rooms = rawRooms.map((room) => ({
      ...room,
      participants: room.type === "private"
        ? room.participants.map((id) => usersById.get(id.toString()) || id)
        : room.participants,
      messages: [],
      medias: [],
      locations: [],
      lastMsgData: lastMessagesByRoom.get(room._id.toString()) || null,
      notSeenCount: unreadByRoom.get(room._id.toString()) || 0,
    }));

    for (const room of rooms) socket.join(room._id.toString());
    socket.emit("getRooms", rooms);
  });

  on("joining", async (query) => {
    if (!(await allowEvent(userID, "joining", 20, 60_000))) return;
    try {
      if (!isValidId(query)) return;
      const roomData = await RoomSchema.findOne({ _id: query, participants: userID })
        .populate("medias", "", MediaSchema)
        .populate("locations", "", LocationSchema)
        .lean();

      if (!roomData) return socket.emit("error", { message: "Room not found" });

      const messages = await MessageSchema.find({ roomID: roomData._id, hideFor: { $nin: [userID] } })
        .sort({ createdAt: -1, _id: -1 })
        .limit(50)
        .populate("sender", "name username avatar _id")
        .lean();

      roomData.messages = messages.reverse();
      socket.join(roomData._id.toString());
      if (roomData.type === "private") {
        roomData.participants = await UserSchema.find({ _id: { $in: roomData.participants } })
          .select("name lastName username avatar biography type status _id")
          .lean();
      }
      socket.emit("joining", roomData);
    } catch (error) {
      console.error("joining:", error);
      socket.emit("error", { message: "Unable to open room" });
    }
  });

  on("pinMessage", async (id, roomID, isLastMessage) => {
    if (!(await allowEvent(userID, "pinMessage", 60, 60_000))) return;
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(id, roomID);
    if (!room || !msg || !isAdmin(room, userID)) return socket.emit("error", { message: "Forbidden" });
    msg.pinnedAt = msg.pinnedAt ? null : Date.now();
    await msg.save();
    io.to(roomID).emit("pinMessage", id);
    if (isLastMessage) io.to(roomID).emit("updateLastMsgData", { msgData: msg, roomID });
  });

  on("updateLastMsgPos", async ({ roomID, scrollPos, shouldEmitBack = true }) => {
    if (!(await allowEvent(userID, "updateLastMsgPos", 60, 60_000))) return;
    const room = await isMember(roomID, userID);
    if (!room || !Number.isFinite(Number(scrollPos))) return;
    const userTarget = await UserSchema.findById(userID);
    if (!userTarget) return;
    const track = userTarget.roomMessageTrack || [];
    const existing = track.find((item) => item.roomId === roomID);
    if (existing) existing.scrollPos = Number(scrollPos);
    else track.push({ roomId: roomID, scrollPos: Number(scrollPos) });
    await userTarget.save();
    if (shouldEmitBack) socket.emit("updateLastMsgPos", track);
  });

  on("typing", async (data) => {
    if (!(await allowEvent(userID, "typing", 10, 10_000))) return;
    const room = await isMember(data?.roomID, userID);
    if (!room) return;
    const current = typingByRoom.get(data.roomID) || new Set();
    current.add(userID);
    typingByRoom.set(data.roomID, current);
    const user = await publicUserPromise;
    io.to(data.roomID).emit("typing", { roomID: data.roomID, sender: user });
  });

  on("stop-typing", async (data) => {
    if (!(await allowEvent(userID, "stop-typing", 20, 10_000))) return;
    const room = await isMember(data?.roomID, userID);
    if (!room) return;
    const current = typingByRoom.get(data.roomID) || new Set();
    current.delete(userID);
    if (!current.size) typingByRoom.delete(data.roomID);
    const user = await publicUserPromise;
    io.to(data.roomID).emit("stop-typing", { roomID: data.roomID, sender: user });
  });

  on("updateUserData", async (updatedFields) => {
    if (!(await allowEvent(userID, "updateUserData", 20, 60_000))) return;
    const allowed = ["name", "lastName", "username", "avatar", "biography"];
    const $set = {};
    for (const key of allowed) {
      if (updatedFields && Object.prototype.hasOwnProperty.call(updatedFields, key)) $set[key] = updatedFields[key];
    }
    for (const key of ["name", "lastName", "username", "avatar", "biography"]) {
      if (Object.prototype.hasOwnProperty.call($set, key) && typeof $set[key] !== "string") {
        return socket.emit("updateUserDataError", { message: "Invalid profile data" });
      }
    }
    if (Object.prototype.hasOwnProperty.call($set, "avatar")) {
      const current = await UserSchema.findById(userID).select("avatar").lean();
      if (!(await isAllowedAvatar($set.avatar, userID, current?.avatar))) {
        return socket.emit("updateUserDataError", { message: "Invalid avatar" });
      }
    }
    if (typeof $set.name === "string") $set.name = $set.name.slice(0, 20);
    if (typeof $set.lastName === "string") $set.lastName = $set.lastName.slice(0, 20);
    if (typeof $set.username === "string") {
      $set.username = $set.username.replace(/^@/, "").trim().slice(0, 20).toLowerCase();
      if (!/^[a-zA-Z0-9_]{3,20}$/.test($set.username)) {
        return socket.emit("updateUserDataError", { message: "Invalid username" });
      }
      const duplicate = await UserSchema.findOne({ username: $set.username, _id: { $ne: userID } }).select("_id").lean();
      if (duplicate) return socket.emit("updateUserDataError", { message: "Username already exists" });
    }
    if (typeof $set.biography === "string") $set.biography = $set.biography.slice(0, 70);
    try {
      await UserSchema.updateOne({ _id: userID }, { $set }, { runValidators: true });
      socket.emit("updateUserData");
    } catch (error) {
      console.error("updateUserData:", error);
      socket.emit("updateUserDataError", { message: "Unable to update profile" });
    }
  });

  on("updateRoomData", async (updatedFields) => {
    if (!(await allowEvent(userID, "updateRoomData", 30, 60_000))) return;
    try {
      const roomID = updatedFields?.roomID;
      if (!isValidId(roomID)) return socket.emit("updateRoomDataError", { message: "Invalid room" });
      const room = await RoomSchema.findById(roomID);
      if (!room || !isAdmin(room, userID)) return socket.emit("updateRoomDataError", { message: "Forbidden" });

      const $set = {};
      for (const key of ["name", "avatar", "biography", "link"]) {
        if (updatedFields && Object.prototype.hasOwnProperty.call(updatedFields, key)) $set[key] = updatedFields[key];
      }

      if (Object.prototype.hasOwnProperty.call($set, "avatar") && !(await isAllowedAvatar($set.avatar, userID, room.avatar))) {
        return socket.emit("updateRoomDataError", { message: "Invalid avatar" });
      }

      if (room.type === "private" && (["name", "link"].some((key) => Object.prototype.hasOwnProperty.call($set, key)) || Array.isArray(updatedFields?.participants))) {
        return socket.emit("updateRoomDataError", { message: "Private rooms cannot be administratively modified" });
      }

      if (Array.isArray(updatedFields?.participants)) {
        const requested = [...new Set(
          updatedFields.participants
            .map((id) => typeof id === "string" ? id : id?._id)
            .filter(isValidId),
        )];
        const existingUsers = await UserSchema.find({ _id: { $in: requested } }).select("_id").lean();
        const validIds = new Set(existingUsers.map((u) => u._id.toString()));
        const participants = [...new Set([room.creator?.toString(), ...requested])]
          .filter((id) => Boolean(id) && (validIds.has(id) || id === room.creator?.toString()))
          .slice(0, 500);
        $set.participants = participants;
      }
      if (typeof $set.name === "string") $set.name = $set.name.trim().slice(0, 100);
      if (typeof $set.biography === "string") $set.biography = $set.biography.slice(0, 1000);
      if (typeof $set.link === "string") {
        $set.link = $set.link.trim().toLowerCase();
        if ($set.link && !/^@[a-f0-9]{20}$/.test($set.link)) {
          return socket.emit("updateRoomDataError", { message: "Invalid room link" });
        }
        const duplicateLink = await RoomSchema.findOne({ link: $set.link, _id: { $ne: roomID } }).select("_id").lean();
        if (duplicateLink) return socket.emit("updateRoomDataError", { message: "Link already exists" });
      }

      const previousParticipants = new Set(room.participants.map((id) => id.toString()));
      const updatedRoom = await RoomSchema.findOneAndUpdate(
        { _id: roomID },
        { $set },
        { new: true, runValidators: true }
      );
      if (Array.isArray($set.participants)) {
        const nextParticipants = new Set($set.participants.map((id) => id.toString()));
        for (const memberID of previousParticipants) {
          if (nextParticipants.has(memberID)) continue;
          for (const socketID of onlineUsers.get(memberID) || []) {
            io.sockets.sockets.get(socketID)?.leave(roomID);
          }
        }
        for (const memberID of nextParticipants) {
          for (const socketID of onlineUsers.get(memberID) || []) {
            io.sockets.sockets.get(socketID)?.join(roomID);
          }
        }
      }
      io.to(roomID).emit("updateRoomData", updatedRoom);
    } catch (error) {
      console.error("updateRoomData:", error);
      socket.emit("updateRoomDataError", { message: "Unable to update room" });
    }
  });

  on("getRoomMembers", async ({ roomID }) => {
    if (!(await allowEvent(userID, "getRoomMembers", 20, 60_000))) return;
    const room = await isMember(roomID, userID);
    if (!room) return socket.emit("error", { message: "Forbidden" });
    const populated = await room.populate({ path: "participants", select: "name lastName username avatar biography type status _id" });
    socket.emit("getRoomMembers", populated.participants.map((u) => {
      const data = u.toObject();
      delete data.password;
      return data;
    }));
  });

  const sessionCheckTimer = setInterval(async () => {
    try {
      const active = await UserSchema.findOne({ _id: userID, sessionVersion: socket.sessionVersion }).select("_id").lean();
      if (!active) socket.disconnect(true);
    } catch {
      socket.disconnect(true);
    }
  }, 60_000);
  sessionCheckTimer.unref();

  on("loadOlderMessages", async ({ roomID, before, limit = 50 }, callback = () => {}) => {
    if (!(await allowEvent(userID, "loadOlderMessages", 60, 60_000))) {
      return callback({ success: false, error: "Rate limit exceeded" });
    }
    try {
      if (!isValidId(roomID) || !isValidId(before)) return callback({ success: false, error: "Invalid cursor" });
      const room = await isMember(roomID, userID);
      if (!room) return callback({ success: false, error: "Forbidden" });
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
      const cursor = await MessageSchema.findOne({ _id: before, roomID }).select("createdAt").lean();
      if (!cursor) return callback({ success: false, error: "Invalid cursor" });
      const messages = await MessageSchema.find({
        roomID,
        hideFor: { $nin: [userID] },
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
        ],
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(safeLimit)
        .populate("sender", publicUserFields)
        .lean();
      callback({ success: true, messages: messages.reverse(), hasMore: messages.length === safeLimit });
    } catch (error) {
      console.error("loadOlderMessages:", error);
      callback({ success: false, error: "Unable to load messages" });
    }
  });

  socket.on("disconnect", () => {
    clearInterval(sessionCheckTimer);
    const typingRooms = [...typingByRoom.entries()];
    for (const [roomID, members] of typingRooms) {
      if (members.delete(userID) && !members.size) typingByRoom.delete(roomID);
    }
    for(const [callId,c] of activeCalls){if(c.caller===userID||c.callee===userID){const target=c.caller===userID?c.callee:c.caller;for(const sid of onlineUsers.get(target)||[])io.sockets.sockets.get(sid)?.emit("call:ended",{callId});activeCalls.delete(callId);}}
    const sockets = onlineUsers.get(userID);
    sockets?.delete(socket.id);
    if (!sockets?.size) onlineUsers.delete(userID);
    broadcastOnlineUsers();
  });
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => console.error("Unhandled Rejection at:", promise, "reason:", reason));
