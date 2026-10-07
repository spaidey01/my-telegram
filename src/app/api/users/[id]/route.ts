import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import SessionSchema from "@/schemas/sessionSchema";
import { sanitizeUserForViewer } from "@/utils/privacy";
import tokenDecoder from "@/utils/TokenDecoder";
import mongoose from "mongoose";
import { cookies } from "next/headers";

const getUserID = async () => {
  const token = (await cookies()).get("token")?.value;
  if (!token) return null;
  try {
    const decoded = tokenDecoder(token);
    return decoded && typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.sv === "number" && typeof decoded.sid === "string" ? { id: decoded.sub, sv: decoded.sv, sid: decoded.sid } : null;
  } catch {
    return null;
  }
};

export const GET = async (_req: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await getUserID();
  if (!auth || !mongoose.isValidObjectId(auth.id) || !mongoose.isValidObjectId(auth.sid)) return Response.json({ message: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) return Response.json({ message: "Invalid user" }, { status: 400 });
  await connectToDB();
  const session = await SessionSchema.findOne({ _id: auth.sid, user: auth.id, revokedAt: null }).select("_id").lean();
  const current = session ? await UserSchema.findOne({ _id: auth.id, sessionVersion: auth.sv }).select("_id").lean() : null;
  if (!current) return Response.json({ message: "Unauthorized" }, { status: 401 });
  const viewerID = auth.id;
  const user = await UserSchema.findById(id).select("name lastName username phone avatar biography type status lastSeenAt _id").lean();
  if (!user) return Response.json({ message: "User not found" }, { status: 404 });
  return Response.json(await sanitizeUserForViewer(user, viewerID, { includePhone: true }));
};
