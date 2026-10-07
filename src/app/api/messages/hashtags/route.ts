import connectToDB from "@/db";
import MessageSchema from "@/schemas/messageSchema";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import SessionSchema from "@/schemas/sessionSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import { rateLimit } from "@/utils/rateLimit";

const auth = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string") return null;
  if (!mongoose.isValidObjectId(decoded.sub) || !mongoose.isValidObjectId(decoded.sid)) return null;
  await connectToDB();
  const [session, user] = await Promise.all([
    SessionSchema.findOne({ _id: decoded.sid, user: decoded.sub, revokedAt: null }).select("_id").lean(),
    UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id").lean(),
  ]);
  return session && user ? decoded : null;
};

export const GET = async (req: Request) => {
  try {
    const d = await auth();
    if (!d) return Response.json({ message: "Unauthorized" }, { status: 401 });
    const limitResult = await rateLimit("hashtag-suggest:" + d.sub, 60, 60_000);
    if (!limitResult.allowed) return Response.json({ message: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limitResult.retryAfter) } });

    const params = new URL(req.url).searchParams;
    const prefix = (params.get("q") || "").trim().replace(/^#/, "").toLowerCase();
    const roomId = (params.get("roomId") || "").trim();
    const limit = Math.min(Math.max(Number(params.get("limit")) || 8, 1), 15);
    if (!prefix || prefix.length > 64 || !/^[\p{L}\p{N}_]+$/u.test(prefix)) return Response.json({ suggestions: [] });
    if (roomId && !mongoose.isValidObjectId(roomId)) return Response.json({ message: "Invalid roomId" }, { status: 400 });

    const memberRooms = await RoomSchema.find({ participants: d.sub }).select("_id").lean();
    const memberRoomIds = memberRooms.map((room) => room._id);
    if (roomId && !memberRoomIds.some((id) => String(id) === roomId)) return Response.json({ message: "Forbidden" }, { status: 403 });

    const roomFilter = roomId ? roomId : { $in: memberRoomIds };
    const values = await MessageSchema.distinct("hashtags", { roomID: roomFilter, hideFor: { $ne: d.sub } });
    const suggestions = values
      .map((value) => String(value).toLowerCase())
      .filter((value) => value.startsWith(prefix))
      .filter((value) => /^[\p{L}\p{N}_]{1,64}$/u.test(value))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);

    return Response.json({ suggestions });
  } catch (error) {
    console.error("messages/hashtags:", error);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};