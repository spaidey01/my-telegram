import { RoomModel, UserModel } from "@/@types/data.t";
import connectToDB from "@/db";
import MessageSchema from "@/schemas/messageSchema";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import { tokenDecoder } from "@/utils";
import { cookies } from "next/headers";
import mongoose from "mongoose";

const escapeRegExp = (text: string) => text.replace(/[-[\\]{}()*+?.,\\^$|#\s]/g, "\\$&");
const getAuthenticatedUserId = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  return decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? decoded.sub : null;
};
const safeUserProjection = "name lastName username avatar biography type status _id";

export const POST = async (req: Request) => {
  try {
    const authenticatedUserID = await getAuthenticatedUserId();
    if (!authenticatedUserID || !mongoose.isValidObjectId(authenticatedUserID)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    await connectToDB();
    const body = await req.json();
    const purePayload = typeof body?.query?.payload === "string" ? body.query.payload.trim() : "";
    if (!purePayload || purePayload.length > 100) return Response.json({ message: "Invalid search query" }, { status: 400 });
    const payload = purePayload.toLowerCase();

    if (payload.startsWith("@")) {
      const searchText = payload.slice(1).trim();
      if (!searchText || searchText.length > 50) return Response.json(null, { status: 404 });

      const result = await RoomSchema.findOne({
        link: { $regex: new RegExp("^" + escapeRegExp(payload) + "$", "i") },
      }).select("_id name avatar type link biography participants creator admins");

      if (result) return Response.json([result], { status: 200 });

      const users = await UserSchema.find({
        username: { $regex: new RegExp("^" + escapeRegExp(searchText) + ".*$", "i") },
      }).select(safeUserProjection).limit(20).lean();

      return users.length ? Response.json(users, { status: 200 }) : Response.json(null, { status: 404 });
    }

    const userRoomsData: any = await RoomSchema.find({ participants: authenticatedUserID })
      .select("_id name avatar type participants messages")
      .lean()
      .then((rooms) => Promise.all(rooms.map((room) => RoomSchema.populate(room, [
        { path: "messages", model: MessageSchema },
        { path: "participants", select: safeUserProjection },
      ]))));

    const searchResult: (RoomModel | (UserModel & { findBy: keyof RoomModel }))[] = [];
    userRoomsData.forEach((roomData: RoomModel & { findBy: keyof RoomModel }) => {
      if (roomData.type !== "private" && roomData.name.toLowerCase().includes(payload)) {
        searchResult.push({ ...roomData, findBy: "name" });
      }
      if (roomData.type === "private") {
        const otherParticipant = roomData.participants.find((data: UserModel) => data._id.toString() !== authenticatedUserID);
        if (otherParticipant && otherParticipant.name.toLowerCase().includes(payload)) {
          searchResult.push({ ...roomData, findBy: "participants", name: otherParticipant.name, lastName: otherParticipant.lastName, avatar: otherParticipant.avatar });
        }
      }
      roomData.messages.forEach((msgData) => {
        const isMsgDeletedForUser = msgData.hideFor.some((id) => id.toString() === authenticatedUserID);
        if (!isMsgDeletedForUser && typeof msgData.message === "string" && msgData.message.toLowerCase().includes(payload)) {
          const otherParticipant = roomData.participants.find((data: UserModel) => data._id.toString() !== authenticatedUserID);
          const isMe = roomData.participants.find((data: UserModel) => data._id.toString() === authenticatedUserID);
          searchResult.push({
            ...roomData,
            findBy: "messages",
            messages: [msgData],
            name: roomData.type === "private" ? otherParticipant?.name || (isMe ? "Saved messages" : "") : roomData.name,
            lastName: roomData.type === "private" ? otherParticipant?.lastName ?? "" : "",
            avatar: roomData.type === "private" ? otherParticipant?.avatar ?? "" : roomData.avatar,
          });
        }
      });
    });
    return Response.json(searchResult, { status: 200 });
  } catch (err) {
    console.error("users/find:", err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};