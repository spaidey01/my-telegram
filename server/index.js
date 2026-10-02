import { Server } from "socket.io";
import jwt from "jsonwebtoken";
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

const io = new Server(3001, {
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

console.log("Socket server is running on port 3001");

const onlineUsers = new Map();
const typingByRoom = new Map();

await connectToDB();

const getUserId = (socket) => socket.userId;

const isMember = async (roomID, userID) => {
  if (!roomID || !userID) return null;
  return RoomSchema.findOne({ _id: roomID, participants: userID });
};

const isAdmin = (room, userID) =>
  !!room && (room.creator?.toString() === userID || room.admins?.some((id) => id.toString() === userID));

const isMessageInRoom = async (msgID, roomID) =>
  MessageSchema.findOne({ _id: msgID, roomID });

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));
    const decoded = jwt.verify(token, secret);
    if (!decoded || decoded.scope !== "socket" || !decoded.sub) return next(new Error("Unauthorized"));
    socket.userId = decoded.sub.toString();
    socket.userTokenExp = decoded.exp;
    return next();
  } catch {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userID = getUserId(socket);
  onlineUsers.set(userID, (onlineUsers.get(userID) || new Set()).add(socket.id));

  const broadcastOnlineUsers = () => {
    const ids = [...onlineUsers.keys()].map((userID) => ({ userID }));
    io.emit("updateOnlineUsers", ids);
  };
  broadcastOnlineUsers();

  socket.on("newMessage", async ({ roomID, message, replayData, voiceData = null, tempId }, callback = () => {}) => {
    try {
      const room = await isMember(roomID, userID);
      if (!room) return callback({ success: false, error: "Forbidden" });
      if (typeof message !== "string" || message.length > 10000) return callback({ success: false, error: "Invalid message" });

      if (tempId) {
        const existing = await MessageSchema.findOne({ tempId }).lean();
        if (existing) return callback({ success: true, _id: existing._id });
      }

      const msgData = {
        sender: userID,
        message,
        roomID,
        seen: [],
        voiceData,
        createdAt: Date.now(),
        tempId,
        status: "sent",
      };

      const newMsg = await MessageSchema.create(msgData);

      if (replayData?.targetID) {
        const target = await isMessageInRoom(replayData.targetID, roomID);
        if (target) {
          await MessageSchema.updateOne({ _id: target._id }, { $push: { replays: newMsg._id } });
          newMsg.replayedTo = {
            message: typeof replayData.replayedTo?.message === "string" ? replayData.replayedTo.message : "",
            msgID: newMsg._id.toString(),
            username: typeof replayData.replayedTo?.username === "string" ? replayData.replayedTo.username : "",
          };
          await newMsg.save();
        }
      }

      await RoomSchema.updateOne({ _id: roomID }, { $push: { messages: newMsg._id } });

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
    try {
      if (!newRoomData || !["private", "group", "channel"].includes(newRoomData.type)) return;
      const requestedParticipants = Array.isArray(newRoomData.participants)
        ? newRoomData.participants.map((p) => (typeof p === "string" ? p : p?._id)).filter(Boolean)
        : [];
      const participants = [...new Set([userID, ...requestedParticipants])];

      if (newRoomData.type === "private" && participants.length !== 2) return;

      const roomData = {
        name: typeof newRoomData.name === "string" ? newRoomData.name.trim().slice(0, 100) : "New Room",
        avatar: typeof newRoomData.avatar === "string" ? newRoomData.avatar : "",
        type: newRoomData.type,
        creator: userID,
        admins: [userID],
        participants,
        link: typeof newRoomData.link === "string" ? newRoomData.link.slice(0, 500) : undefined,
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
          voiceData: message.voiceData || null,
          status: "sent",
        });
        newRoom.messages = [newMsg._id];
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
    try {
      const room = await RoomSchema.findById(roomID);
      if (!room || room.type === "private") return;
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
    const room = await RoomSchema.findById(roomID);
    if (!room || !isAdmin(room, userID)) return socket.emit("error", { message: "Forbidden" });
    io.to(roomID).emit("deleteRoom", roomID);
    io.to(roomID).emit("updateLastMsgData", { msgData: null, roomID });
    await RoomSchema.deleteOne({ _id: roomID });
    await MessageSchema.deleteMany({ roomID });
  });

  socket.on("deleteMsg", async ({ forAll, msgID, roomID }) => {
    const room = await isMember(roomID, userID);
    const msg = await isMessageInRoom(msgID, roomID);
    if (!room || !msg) return socket.emit("error", { message: "Forbidden" });

    if (forAll) {
      if (msg.sender.toString() !== userID && !isAdmin(room, userID)) return socket.emit("error", { message: "Forbidden" });
      await MessageSchema.deleteOne({ _id: msgID });
      await RoomSchema.updateOne({ _id: roomID }, { $pull: { messages: msgID } });
      io.to(roomID).emit("deleteMsg", msgID);
    } else {
      await MessageSchema.updateOne({ _id: msgID }, { $addToSet: { hideFor: userID } });
      socket.emit("deleteMsg", msgID);
    }

    const lastMsg = await MessageSchema.findOne({ roomID, hideFor: { $nin: [userID] } }).sort({ createdAt: -1 }).lean();
    io.to(roomID).emit("updateLastMsgData", { msgData: lastMsg || null, roomID });
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
      await MessageSchema.updateOne({ _id: voiceID }, { $push: { "voiceData.playedBy": userID + "_" + new Date().toISOString() } });
    }
    io.to(roomID).emit("listenToVoice", { userID, voiceID, roomID });
  });

  socket.on("getVoiceMessageListeners", async (msgID) => {
    const targetMessage = await MessageSchema.findById(msgID);
    if (!targetMessage) return;
    const room = await isMember(targetMessage.roomID, userID);
    if (!room) return;
    const playedBy = targetMessage.voiceData?.playedBy || [];
    const ids = [...new Set(playedBy.map((v) => v.split("_")[0]))];
    const users = await UserSchema.find({ _id: { $in: ids } }).select("-password").lean();
    socket.emit("getVoiceMessageListeners", users.map((data) => ({
      ...data,
      seenTime: playedBy.find((v) => v.startsWith(data._id.toString() + "_"))?.split("_").slice(1).join("_") || null,
    })));
  });

  socket.on("getRooms", async () => {
    const rawRooms = await RoomSchema.find({ participants: userID }).lean();
    const userRooms = await Promise.all(rawRooms.map(async (room) => {
      if (room.type !== "private") return room;
      const participants = await UserSchema.find({ _id: { $in: room.participants } }).select("name username avatar _id").lean();
      return { ...room, participants };
    }));
    for (const room of userRooms) socket.join(room._id.toString());

    const rooms = await Promise.all(userRooms.map(async (room) => {
      const lastMsgData = room.messages?.length
        ? await MessageSchema.findById(room.messages.at(-1)).populate("sender", "name username avatar _id").lean()
        : null;
      const notSeenCount = await MessageSchema.countDocuments({
        roomID: room._id, sender: { $ne: userID }, seen: { $nin: [userID] },
      });
      return { ...room, lastMsgData, notSeenCount };
    }));

    socket.emit("getRooms", rooms);
  });

  socket.on("joining", async (query) => {
    try {
      if (!query) return;
      const roomData = await RoomSchema.findOne({
        $and: [{ $or: [{ _id: query }, { name: query }] }, { participants: userID }],
      })
        .populate("messages", "", MessageSchema)
        .populate("medias", "", MediaSchema)
        .populate("locations", "", LocationSchema)
        .populate({ path: "messages", populate: { path: "sender", model: UserSchema, select: "name username avatar _id" } });

      if (!roomData) return socket.emit("error", { message: "Room not found" });
      socket.join(roomData._id.toString());
      if (roomData.type === "private") await roomData.populate("participants");
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
    const room = await isMember(data?.roomID, userID);
    if (!room) return;
    const current = typingByRoom.get(data.roomID) || new Set();
    current.add(userID);
    typingByRoom.set(data.roomID, current);
    const user = await UserSchema.findById(userID).select("name username avatar _id").lean();
    io.to(data.roomID).emit("typing", { roomID: data.roomID, sender: user });
  });

  socket.on("stop-typing", async (data) => {
    const room = await isMember(data?.roomID, userID);
    if (!room) return;
    const current = typingByRoom.get(data.roomID) || new Set();
    current.delete(userID);
    if (!current.size) typingByRoom.delete(data.roomID);
    const user = await UserSchema.findById(userID).select("name username avatar _id").lean();
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
    if (typeof $set.username === "string") $set.username = $set.username.replace(/^@/, "").slice(0, 20).toLowerCase();
    if (typeof $set.biography === "string") $set.biography = $set.biography.slice(0, 70);
    await UserSchema.updateOne({ _id: userID }, { $set });
    socket.emit("updateUserData");
  });

  socket.on("updateRoomData", async (updatedFields) => {
    try {
      const roomID = updatedFields?.roomID;
      const room = await RoomSchema.findById(roomID);
      if (!room || !isAdmin(room, userID)) return socket.emit("updateRoomDataError", { message: "Forbidden" });

      const $set = {};
      for (const key of ["name", "avatar", "biography", "link"]) {
        if (updatedFields && Object.prototype.hasOwnProperty.call(updatedFields, key)) $set[key] = updatedFields[key];
      }
      if (typeof $set.name === "string") $set.name = $set.name.trim().slice(0, 100);
      if (typeof $set.biography === "string") $set.biography = $set.biography.slice(0, 1000);
      if (typeof $set.link === "string") $set.link = $set.link.slice(0, 500);

      const updatedRoom = await RoomSchema.findOneAndUpdate({ _id: roomID }, { $set }, { new: true });
      io.to(roomID).emit("updateRoomData", updatedRoom);
    } catch (error) {
      console.error("updateRoomData:", error);
      socket.emit("updateRoomDataError", { message: "Unable to update room" });
    }
  });

  socket.on("getRoomMembers", async ({ roomID }) => {
    const room = await isMember(roomID, userID);
    if (!room) return socket.emit("error", { message: "Forbidden" });
    const populated = await room.populate("participants");
    socket.emit("getRoomMembers", populated.participants.map((u) => {
      const data = u.toObject();
      delete data.password;
      return data;
    }));
  });

  socket.on("disconnect", () => {
    const sockets = onlineUsers.get(userID);
    sockets?.delete(socket.id);
    if (!sockets?.size) onlineUsers.delete(userID);
    broadcastOnlineUsers();
  });
});

process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
process.on("unhandledRejection", (reason, promise) => console.error("Unhandled Rejection at:", promise, "reason:", reason));
