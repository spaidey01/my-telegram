import connectToDB from "@/db";
import MessageSchema from "@/schemas/messageSchema";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import { rateLimit } from "@/utils/rateLimit";
import { sanitizeUserForViewer } from "@/utils/privacy";

const getAuth = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number") return null;
  if (!mongoose.isValidObjectId(decoded.sub)) return null;
  return decoded;
};

const parseDate = (value: string | null, endOfDay = false) => {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (endOfDay) date.setUTCHours(23, 59, 59, 999);
    else date.setUTCHours(0, 0, 0, 0);
  }
  return date;
};

export const GET = async (req: Request) => {
  try {
    const auth = await getAuth();
    if (!auth) return Response.json({ message: "Unauthorized" }, { status: 401 });
    const limitResult = await rateLimit("messages-search:" + auth.sub, 30, 60_000);
    if (!limitResult.allowed) return Response.json({ message: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limitResult.retryAfter) } });

    await connectToDB();
    const sessionUser = await UserSchema.findOne({ _id: auth.sub, sessionVersion: auth.sv }).select("_id").lean();
    if (!sessionUser) return Response.json({ message: "Unauthorized" }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const query = (params.get("query") || "").trim();
    const roomId = (params.get("roomId") || "").trim();
    const senderId = (params.get("senderId") || "").trim();
    const from = parseDate(params.get("from"));
    const to = parseDate(params.get("to"), true);

    if (!query || query.length > 100) return Response.json({ message: "query is required and must be <= 100 characters" }, { status: 400 });
    if (roomId && !mongoose.isValidObjectId(roomId)) return Response.json({ message: "Invalid roomId" }, { status: 400 });
    if (senderId && !mongoose.isValidObjectId(senderId)) return Response.json({ message: "Invalid senderId" }, { status: 400 });
    if (params.has("from") && !from) return Response.json({ message: "Invalid from date" }, { status: 400 });
    if (params.has("to") && !to) return Response.json({ message: "Invalid to date" }, { status: 400 });
    if (from && to && from > to) return Response.json({ message: "from must be before to" }, { status: 400 });

    const memberRooms = await RoomSchema.find({ participants: auth.sub }).select("_id").lean();
    const memberRoomIds = memberRooms.map((room) => room._id);
    if (roomId && !memberRoomIds.some((id) => String(id) === roomId)) return Response.json({ message: "Forbidden" }, { status: 403 });

    const filter: Record<string, unknown> = {
      roomID: roomId ? roomId : { $in: memberRoomIds },
      hideFor: { $ne: auth.sub },
      $text: { $search: query },
    };
    if (senderId) filter.sender = senderId;
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.$gte = from;
      if (to) createdAt.$lte = to;
      filter.createdAt = createdAt;
    }

    const messages = await MessageSchema.find(filter)
      .select("_id roomID sender message createdAt attachmentData stickerData voiceData pinnedAt")
      .sort({ score: { $meta: "textScore" }, createdAt: -1, _id: -1 })
      .limit(100)
      .populate("sender", "name username avatar _id")
      .lean();

    const rooms = await RoomSchema.find({ _id: { $in: [...new Set(messages.map((message) => String(message.roomID)))] } })
      .select("_id name type avatar participants")
      .lean();
    const roomById = new Map(rooms.map((room) => [String(room._id), room]));

    const results = await Promise.all(messages.map(async (message) => ({
      ...message,
      sender: message.sender ? await sanitizeUserForViewer(message.sender, auth.sub) : message.sender,
      room: roomById.get(String(message.roomID)) || null,
    })));

    return Response.json({ results, count: results.length });
  } catch (error) {
    console.error("messages/search:", error);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
