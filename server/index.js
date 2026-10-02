import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import RoomSchema from "../src/schemas/roomSchema.js";
import MessageSchema from "../src/schemas/messageSchema.js";
import MediaSchema from "../src/schemas/mediaSchema.js";
import LocationSchema from "../src/schemas/locationSchema.js";
import UserSchema from "../src/schemas/userSchema.js";
import connectToDB from "../src/db/index.js";

const secret = process.env.secretKey;
if (!secret) throw new Error("secretKey is not configured");

const allowedOrigins = (process.env.CLIENT_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  .split(",").map((v) => v.trim()).filter(Boolean);

const socketPort = Number(process.env.SOCKET_PORT || process.env.PORT || 3001);
const io = new Server(socketPort, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
  },
  pingTimeout: 30000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  },
});

console.log(`Socket server is running on port ${socketPort}`);

const onlineUsers = new Map();
const typingByRoom = new Map();
const eventBuckets = new Map();

const allowEvent = (userID, event, limit, windowMs) => {
  const key = userID + ":" + event;
  const now = Date.now();
  const bucket = eventBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
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

const sanitizeVoiceData = (voiceData) => {
  if (voiceData == null) return null;
  if (typeof voiceData !== "object") return null;
  const src = typeof voiceData.src === "string" ? voiceData.src.trim() : "";
  const duration = Number(voiceData.duration);
  if (!src || src.length > 2048 || !Number.isFinite(duration) || duration < 0 || duration > 3600) return null;
  return { src, duration, playedBy: [] };
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
    const decoded = jwt.verify(token, secret);
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

  socket.on("newMessage", async ({ roomID, message, replayData, voiceData = null, tempId }, callback = () => {}) => {
    if (!allowEvent(userID, "newMessage", 30, 60_000)) return callback({ success: false, error: "Rate limit exceeded" });
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
        voiceData: sanitizeVoiceData(voiceData),
        createdAt: Date.now(),
        tempId: scopedTempId,
        status: "sent",
      };

      const newMsg = await MessageSchema.create(msgData);

      if (replayData?.targetID) {
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

  socket.on("createRoom", async ({ newRoomData, message = null }) => {
    if (!allowEvent(userID, "createRoom", 10, 60_000)) return;
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

      const roomData = {
        name: typeof newRoomData.name === "string" ? newRoomData.name.trim().slice(0, 100) : "New Room",
        avatar: typeof newRoomData.avatar === "string" ? newRoomData.avatar : "",
        type: newRoomData.type,
        creator: userID,
        admins: [userID],
        participants,
        link: typeof newRoomData.link === "string" && newRoomData.link.trim()
          ? newRoomData.link.trim().slice(0, 500)
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
          voiceData: sanitizeVoiceData(message.voiceData),
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

  socket.on("joinRoom", async ({ roomID }) => {
    if (!allowEvent(userID, "joinRoom", 20, 60_000)) return;
    try {
      if (!isValidId(roomID)) return;
      const room = await RoomSchema.findById(roomID);
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

  socket.on("deleteRoom", async (roomID) => {
    if (!isValidId(roomID)) return socket.emit("error", { message: "Invalid room" });
    const room = await RoomSchema.findById(roomID);
    if (!room || !isAdmin(room, userID)) return socket.emit("error", { message: "Forbidden" });
    io.to(roomID).emit("deleteRoom", roomID);
    io.to(roomID).emit("updateLastMsgData", { msgData: null, roomID });
    await Promise.all([
      RoomSchema.deleteOne({ _id: roomID }),
      MessageSchema.deleteMany({ roomID }),
      MediaSchema.deleteMany({ roomID }),
      LocationSchema.deleteMany({ roomID }),
    ]);
  });

  socket.on("deleteMsg", async ({ forAll, msgID, roomID }) => {
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg) return socket.emit("error", { message: "Forbidden" });

    if (forAll) {
      if (msg.sender.toString() !== userID && !isAdmin(room, userID)) return socket.emit("error", { message: "Forbidden" });
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

  socket.on("editMessage", async ({ msgID, editedMsg, roomID }) => {
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg || msg.sender.toString() !== userID || typeof editedMsg !== "string" || editedMsg.length > 10000) return socket.emit("error", { message: "Forbidden" });

    const updated = await MessageSchema.findOneAndUpdate({ _id: msgID, roomID, sender: userID }, { message: editedMsg, isEdited: true }, { new: true }).lean();
    if (!updated) return;
    io.to(roomID).emit("editMessage", { msgID, editedMsg, roomID });
    const lastMsg = await MessageSchema.findOne({ roomID }).sort({ createdAt: -1 }).lean();
    if (lastMsg?._id.toString() === msgID) io.to(roomID).emit("updateLastMsgData", { roomID, msgData: updated });
  });

  socket.on("seenMsg", async ({ msgID, roomID, readTime }) => {
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg) return;
    const safeReadTime = readTime && !Number.isNaN(Date.parse(readTime)) ? new Date(readTime) : new Date();
    await MessageSchema.updateOne({ _id: msgID }, { $addToSet: { seen: userID }, $set: { readTime: safeReadTime } });
    io.to(roomID).emit("seenMsg", { msgID, roomID, seenBy: userID, readTime: safeReadTime });
  });

  socket.on("listenToVoice", async ({ voiceID, roomID }) => {
    const room = await isMember(roomID, userID);
    const targetMessage = await isMessageInRoom(voiceID, roomID);
    if (!room || !targetMessage?.voiceData) return;
    const playedBy = targetMessage.voiceData.playedBy || [];
    if (!playedBy.some((v) => v === userID || v.startsWith(userID + "_"))) {
      await MessageSchema.updateOne({ _id: voiceID }, { $addToSet: { "voiceData.playedBy": userID } });
    }
    io.to(roomID).emit("listenToVoice", { userID, voiceID, roomID });
  });

  socket.on("getVoiceMessageListeners", async (msgID) => {
    if (!allowEvent(userID, "getVoiceMessageListeners", 30, 60_000) || !isValidId(msgID)) return;
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

  socket.on("getRooms", async () => {
    if (!allowEvent(userID, "getRooms", 20, 60_000)) return;

    const rawRooms = await RoomSchema.find({ participants: userID })
      .select("_id name avatar type participants admins creator link biography lastMessageId lastMessageAt createdAt updatedAt")
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
          { $group: { _id: "$roomID", message: { $first: "$ROOT" } } },
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

  socket.on("joining", async (query) => {
    if (!allowEvent(userID, "joining", 20, 60_000)) return;
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

  socket.on("pinMessage", async (id, roomID, isLastMessage) => {
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(id, roomID);
    if (!room || !msg || !isAdmin(room, userID)) return socket.emit("error", { message: "Forbidden" });
    msg.pinnedAt = msg.pinnedAt ? null : Date.now();
    await msg.save();
    io.to(roomID).emit("pinMessage", id);
    if (isLastMessage) io.to(roomID).emit("updateLastMsgData", { msgData: msg, roomID });
  });

  socket.on("updateLastMsgPos", async ({ roomID, scrollPos, shouldEmitBack = true }) => {
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

  socket.on("typing", async (data) => {
    if (!allowEvent(userID, "typing", 10, 10_000)) return;
    const room = await isMember(data?.roomID, userID);
    if (!room) return;
    const current = typingByRoom.get(data.roomID) || new Set();
    current.add(userID);
    typingByRoom.set(data.roomID, current);
    const user = await publicUserPromise;
    io.to(data.roomID).emit("typing", { roomID: data.roomID, sender: user });
  });

  socket.on("stop-typing", async (data) => {
    if (!allowEvent(userID, "stop-typing", 20, 10_000)) return;
    const room = await isMember(data?.roomID, userID);
    if (!room) return;
    const current = typingByRoom.get(data.roomID) || new Set();
    current.delete(userID);
    if (!current.size) typingByRoom.delete(data.roomID);
    const user = await publicUserPromise;
    io.to(data.roomID).emit("stop-typing", { roomID: data.roomID, sender: user });
  });

  socket.on("updateUserData", async (updatedFields) => {
    const allowed = ["name", "lastName", "username", "avatar", "biography"];
    const $set = {};
    for (const key of allowed) {
      if (updatedFields && Object.prototype.hasOwnProperty.call(updatedFields, key)) $set[key] = updatedFields[key];
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
    await UserSchema.updateOne({ _id: userID }, { $set }, { runValidators: true });
    socket.emit("updateUserData");
  });

  socket.on("updateRoomData", async (updatedFields) => {
    try {
      const roomID = updatedFields?.roomID;
      if (!isValidId(roomID)) return socket.emit("updateRoomDataError", { message: "Invalid room" });
      const room = await RoomSchema.findById(roomID);
      if (!room || !isAdmin(room, userID)) return socket.emit("updateRoomDataError", { message: "Forbidden" });

      const $set = {};
      for (const key of ["name", "avatar", "biography", "link"]) {
        if (updatedFields && Object.prototype.hasOwnProperty.call(updatedFields, key)) $set[key] = updatedFields[key];
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
        $set.link = $set.link.trim().slice(0, 500);
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

  socket.on("getRoomMembers", async ({ roomID }) => {
    if (!allowEvent(userID, "getRoomMembers", 20, 60_000)) return;
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

  socket.on("loadOlderMessages", async ({ roomID, before, limit = 50 }, callback = () => {}) => {
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
    const sockets = onlineUsers.get(userID);
    sockets?.delete(socket.id);
    if (!sockets?.size) onlineUsers.delete(userID);
    broadcastOnlineUsers();
  });
});

process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
process.on("unhandledRejection", (reason, promise) => console.error("Unhandled Rejection at:", promise, "reason:", reason));
