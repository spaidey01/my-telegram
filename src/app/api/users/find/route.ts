import connectToDB from "@/db";
import MessageSchema from "@/schemas/messageSchema";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import mongoose from "mongoose";

const escapeRegExp = (text: string) => text.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
const safeUserProjection = "name lastName username avatar biography type status _id";

const getAuthenticatedUserId = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  return decoded && typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.sv === "number"
    ? { id: decoded.sub, sv: decoded.sv }
    : null;
};

export const POST = async (req: Request) => {
  try {
    const auth = await getAuthenticatedUserId();
    if (!auth || !mongoose.isValidObjectId(auth.id)) return Response.json({ message: "Unauthorized" }, { status: 401 });

    await connectToDB();
    const sessionUser = await UserSchema.findOne({ _id: auth.id, sessionVersion: auth.sv }).select("_id").lean();
    if (!sessionUser) return Response.json({ message: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const purePayload = typeof body?.query?.payload === "string" ? body.query.payload.trim() : "";
    if (!purePayload || purePayload.length > 100) return Response.json({ message: "Invalid search query" }, { status: 400 });

    const payload = purePayload.toLowerCase();
    const expression = new RegExp(escapeRegExp(payload), "i");

    if (payload.startsWith("@")) {
      const searchText = payload.slice(1).trim();
      if (!searchText || searchText.length > 50) return Response.json(null, { status: 404 });

      const room = await RoomSchema.findOne({
        link: { $regex: new RegExp("^" + escapeRegExp(payload) + "$", "i") },
      }).select("_id name avatar type link biography participants creator admins").lean();

      if (room) return Response.json([room], { status: 200 });

      const users = await UserSchema.find({
        username: { $regex: new RegExp("^" + escapeRegExp(searchText), "i") },
      }).select(safeUserProjection).limit(20).lean();

      return users.length ? Response.json(users, { status: 200 }) : Response.json(null, { status: 404 });
    }

    const rooms = await RoomSchema.find({ participants: auth.id })
      .select("_id name avatar type participants admins creator link biography")
      .lean();

    const roomIds = rooms.map((room) => room._id);
    const privateParticipantIds = rooms
      .filter((room) => room.type === "private")
      .flatMap((room) => room.participants.map((id: unknown) => String(id)))
      .filter((id) => id !== auth.id);

    const [participants, matchingMessages] = await Promise.all([
      privateParticipantIds.length
        ? UserSchema.find({ _id: { $in: [...new Set(privateParticipantIds)] }, name: { $regex: expression } })
            .select(safeUserProjection)
            .limit(50)
            .lean()
        : [],
      roomIds.length
        ? MessageSchema.find({ roomID: { $in: roomIds }, hideFor: { $nin: [auth.id] }, message: { $regex: expression } })
            .sort({ createdAt: -1 })
            .limit(100)
            .populate("sender", "name username avatar _id")
            .lean()
        : [],
    ]);

    const roomById = new Map(rooms.map((room) => [String(room._id), room]));
    const results: Record<string, unknown>[] = [];

    for (const room of rooms) {
      if (room.type !== "private" && expression.test(room.name)) results.push({ ...room, findBy: "name" });
    }

    for (const participant of participants) {
      const room = rooms.find(
        (candidate) => candidate.type === "private" && candidate.participants.some((id: unknown) => String(id) === String(participant._id)),
      );
      if (!room) continue;
      results.push({ ...room, findBy: "participants", name: participant.name, lastName: participant.lastName, avatar: participant.avatar });
    }

    for (const message of matchingMessages) {
      const room = roomById.get(String(message.roomID));
      if (!room) continue;
      const otherParticipant = room.type === "private"
        ? participants.find((user) => room.participants.some((id: unknown) => String(id) === String(user._id)))
        : null;
      results.push({
        ...room,
        findBy: "messages",
        messages: [message],
        name: room.type === "private" ? otherParticipant?.name || "Saved messages" : room.name,
        lastName: room.type === "private" ? otherParticipant?.lastName || "" : "",
        avatar: room.type === "private" ? otherParticipant?.avatar || "" : room.avatar,
      });
    }

    return Response.json(results.slice(0, 100), { status: 200 });
  } catch (err) {
    console.error("users/find:", err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
