import connectToDB from "@/db";
import MessageSchema from "@/schemas/messageSchema";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import { rateLimit } from "@/utils/rateLimit";
import { sanitizeUserForViewer } from "@/utils/privacy";
import SessionSchema from "@/schemas/sessionSchema";

const getAuth = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string") return null;
  if (!mongoose.isValidObjectId(decoded.sub) || !mongoose.isValidObjectId(decoded.sid)) return null;
  return decoded;
};

const parseDate = (value: string | null, endOfDay = false, timezoneOffsetMinutes = 0) => {
  if (!value?.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const base = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    const date = new Date(base + timezoneOffsetMinutes * 60_000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const encodeCursor = (value: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decodeCursor = (value: string | null) => {
  if (!value || value.length > 1000) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || !mongoose.isValidObjectId(parsed.id) || typeof parsed.createdAt !== "string") return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    if (parsed.score !== undefined && (!Number.isFinite(parsed.score) || parsed.score < 0)) return null;
    return { id: new mongoose.Types.ObjectId(parsed.id), createdAt, score: parsed.score };
  } catch {
    return null;
  }
};

export const GET = async (req: Request) => {
  try {
    const auth = await getAuth();
    if (!auth) return Response.json({ message: "Unauthorized" }, { status: 401 });
    const limitResult = await rateLimit("messages-search:" + auth.sub, 30, 60_000);
    if (!limitResult.allowed) return Response.json({ message: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limitResult.retryAfter) } });

    await connectToDB();
    const session = await SessionSchema.findOne({ _id: auth.sid, user: auth.sub, revokedAt: null }).select("_id").lean();
    const sessionUser = session ? await UserSchema.findOne({ _id: auth.sub, sessionVersion: auth.sv }).select("_id").lean() : null;
    if (!sessionUser) return Response.json({ message: "Unauthorized" }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const query = (params.get("query") || "").trim();
    const hashtagParam = (params.get("hashtag") || "").trim().replace(/^#/, "").toLowerCase();
    const roomId = (params.get("roomId") || "").trim();
    const senderId = (params.get("senderId") || "").trim();
    const requestedPage = Math.max(Number(params.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 50);
    const cursorParam = params.get("cursor");
    const cursor = decodeCursor(cursorParam);
    const fromOffset = Number(params.get("fromOffset"));
    const toOffset = Number(params.get("toOffset"));
    const safeFromOffset = Number.isFinite(fromOffset) && Math.abs(fromOffset) <= 14 * 60 ? fromOffset : 0;
    const safeToOffset = Number.isFinite(toOffset) && Math.abs(toOffset) <= 14 * 60 ? toOffset : 0;
    const from = parseDate(params.get("from"), false, safeFromOffset);
    const to = parseDate(params.get("to"), true, safeToOffset);

    if ((!query && !hashtagParam) || query.length > 100 || hashtagParam.length > 64 || (hashtagParam && !/^[\p{L}\p{N}_]+$/u.test(hashtagParam))) return Response.json({ message: "query or hashtag is required and valid" }, { status: 400 });
    if (roomId && !mongoose.isValidObjectId(roomId)) return Response.json({ message: "Invalid roomId" }, { status: 400 });
    if (senderId && !mongoose.isValidObjectId(senderId)) return Response.json({ message: "Invalid senderId" }, { status: 400 });
    if (params.has("from") && !from) return Response.json({ message: "Invalid from date" }, { status: 400 });
    if (params.has("to") && !to) return Response.json({ message: "Invalid to date" }, { status: 400 });
    if (from && to && from > to) return Response.json({ message: "from must be before to" }, { status: 400 });
    if (cursorParam && !cursor) return Response.json({ message: "Invalid cursor" }, { status: 400 });
    if (requestedPage > 1 && !cursor) {
      return Response.json({ message: "Cursor pagination is required after the first page.", code: "CURSOR_REQUIRED" }, { status: 400 });
    }

    const memberRooms = await RoomSchema.find({ participants: auth.sub }).select("_id").lean();
    const memberRoomIds = memberRooms.map((room) => room._id);
    if (roomId && !memberRoomIds.some((id) => String(id) === roomId)) return Response.json({ message: "Forbidden" }, { status: 403 });

    const filter: Record<string, unknown> = {
      roomID: roomId ? roomId : { $in: memberRoomIds },
      hideFor: { $ne: auth.sub },
      ...(hashtagParam ? { hashtags: hashtagParam } : { $text: { $search: query } }),
    };
    if (senderId) filter.sender = senderId;
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.$gte = from;
      if (to) createdAt.$lte = to;
      filter.createdAt = createdAt;
    }

    const pipeline: Record<string, unknown>[] = [{ $match: filter }];
    if (query) {
      pipeline.push({ $addFields: { _searchScore: { $meta: "textScore" } } });
    }

    if (cursor) {
      const cursorMatch = query
        ? {
            $or: [
              { _searchScore: { $lt: cursor.score } },
              { _searchScore: cursor.score, createdAt: { $lt: cursor.createdAt } },
              { _searchScore: cursor.score, createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
            ],
          }
        : {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
            ],
          };
      pipeline.push({ $match: cursorMatch });
    }

    pipeline.push(
      { $sort: query ? { _searchScore: -1, createdAt: -1, _id: -1 } : { createdAt: -1, _id: -1 } },
      { $limit: limit },
      { $project: { _id: 1, createdAt: 1, ...(query ? { _searchScore: 1 } : {}) } },
    );

    const pageRows = await MessageSchema.aggregate(pipeline);
    const ids = pageRows.map((row) => row._id);
    const messages = ids.length
      ? await MessageSchema.find({ _id: { $in: ids } })
        .select("_id roomID sender message createdAt attachmentData stickerData voiceData pinnedAt")
        .populate("sender", "name username avatar _id")
        .lean()
      : [];
    const messageById = new Map(messages.map((message) => [String(message._id), message]));
    const orderedMessages = ids.map((id) => messageById.get(String(id))).filter(Boolean);

    const rooms = await RoomSchema.find({ _id: { $in: [...new Set(orderedMessages.map((message) => String(message.roomID)))] } })
      .select("_id name type avatar")
      .lean();
    const roomById = new Map(rooms.map((room) => [String(room._id), room]));

    const results = await Promise.all(orderedMessages.map(async (message) => ({
      ...message,
      sender: message.sender ? await sanitizeUserForViewer(message.sender, auth.sub) : message.sender,
      room: roomById.get(String(message.roomID)) || null,
    })));

    const lastRow = pageRows.at(-1);
    const hasMore = pageRows.length === limit;
    const nextCursor = hasMore && lastRow
      ? encodeCursor({
          id: String(lastRow._id),
          createdAt: new Date(lastRow.createdAt).toISOString(),
          ...(query ? { score: lastRow._searchScore } : {}),
        })
      : null;

    return Response.json({
      results,
      count: results.length,
      page: requestedPage,
      limit,
      hasMore,
      nextCursor,
    });
  } catch (error) {
    console.error("messages/search:", error);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
