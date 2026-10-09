import connectToDB from "@/db";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import SessionSchema from "@/schemas/sessionSchema";
import { sanitizeUserForViewer } from "@/utils/privacy";
import { rateLimit } from "@/utils/rateLimit";

const escapeRegExp = (text: string) => text.replace(/[.*+?^()|[\]\\]/g, "\\$&").replace(/\$/g, "\\$");
const safeUserProjection = "name lastName username avatar biography type status _id";

const getAuthenticatedUserId = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  return decoded && typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.sv === "number" && typeof decoded.sid === "string"
    ? { id: decoded.sub, sv: decoded.sv, sid: decoded.sid }
    : null;
};

export const POST = async (req: Request) => {
  try {
    const auth = await getAuthenticatedUserId();
    if (!auth || !mongoose.isValidObjectId(auth.id)) return Response.json({ message: "Unauthorized" }, { status: 401 });
    const limit = await rateLimit("users-find:" + auth.id, 30, 60_000);
    if (!limit.allowed) return Response.json({ message: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

    await connectToDB();
    const session = auth.sid ? await SessionSchema.findOne({ _id: auth.sid, user: auth.id, revokedAt: null }).select("_id").lean() : null;
    const sessionUser = session ? await UserSchema.findOne({ _id: auth.id, sessionVersion: auth.sv }).select("_id").lean() : null;
    if (!sessionUser) return Response.json({ message: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const purePayload = typeof body?.query?.payload === "string" ? body.query.payload.trim() : "";
    if (!purePayload || purePayload.length > 100) return Response.json({ message: "Invalid search query" }, { status: 400 });

    const payload = purePayload.toLowerCase();
    const expression = new RegExp(escapeRegExp(payload), "i");

    if (payload.startsWith("@")) {
      const searchText = payload.slice(1).trim();
      if (!searchText || searchText.length > 50) return Response.json(null, { status: 404 });
      const [users, room] = await Promise.all([
        UserSchema.find({ username: { $regex: new RegExp("^" + escapeRegExp(searchText), "i") } }).select(safeUserProjection).limit(20).lean(),
        RoomSchema.findOne({ link: { $regex: new RegExp("^" + escapeRegExp(payload) + "$", "i") } }).select("_id name avatar type link biography").lean(),
      ]);
      const results: unknown[] = await Promise.all(users.map((user) => sanitizeUserForViewer(user, auth.id)));
      if (room) results.push(room);
      return results.length ? Response.json(results, { status: 200 }) : Response.json(null, { status: 404 });
    }

    const rooms = await RoomSchema.find({ participants: auth.id })
      .select("_id name avatar type participants admins creator link biography")
      .sort({ updatedAt: -1, _id: -1 }).limit(500).lean();

    const privateParticipantIds = rooms.filter((room) => room.type === "private")
      .flatMap((room) => room.participants.map((id: unknown) => String(id)))
      .filter((id) => id !== auth.id);

    const participants = privateParticipantIds.length
      ? await UserSchema.find({ _id: { $in: [...new Set(privateParticipantIds)] }, name: { $regex: expression } })
          .select(safeUserProjection).limit(50).lean()
      : [];

    const results: Record<string, unknown>[] = [];
    for (const room of rooms) {
      if (room.type !== "private" && expression.test(room.name)) results.push({ ...room, findBy: "name" });
    }
    for (const participant of participants) {
      const room = rooms.find((candidate) => candidate.type === "private" &&
        candidate.participants.some((id: unknown) => String(id) === String(participant._id)));
      if (!room) continue;
      results.push({ ...room, findBy: "participants", name: participant.name, lastName: participant.lastName, avatar: participant.avatar });
    }
    return Response.json(results.slice(0, 100), { status: 200 });
  } catch (err) {
    console.error("users/find:", err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
