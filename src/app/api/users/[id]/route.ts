import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { sanitizeUserForViewer } from "@/utils/privacy";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { cookies } from "next/headers";

const secret = process.env.secretKey;

const getUserID = async () => {
  if (!secret) return null;
  const token = (await cookies()).get("token")?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
};

export const GET = async (_req: Request, context: { params: Promise<{ id: string }> }) => {
  const viewerID = await getUserID();
  if (!viewerID) return Response.json({ message: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) return Response.json({ message: "Invalid user" }, { status: 400 });
  await connectToDB();
  const user = await UserSchema.findById(id).select("name lastName username phone avatar biography type status lastSeenAt _id").lean();
  if (!user) return Response.json({ message: "User not found" }, { status: 404 });
  return Response.json(await sanitizeUserForViewer(user, viewerID, { includePhone: true }));
};
