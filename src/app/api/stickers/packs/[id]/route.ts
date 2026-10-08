import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import tokenDecoder from "@/utils/TokenDecoder";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import StickerPackSchema from "@/schemas/stickerPackSchema";
import UserStickerPackSchema from "@/schemas/userStickerPackSchema";
import SessionSchema from "@/schemas/sessionSchema";
import { rateLimit } from "@/utils/rateLimit";

const getAuth = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string") return null;
  if (!mongoose.isValidObjectId(decoded.sub) || !mongoose.isValidObjectId(decoded.sid)) return null;
  await connectToDB();
  const session = await SessionSchema.findOne({ _id: decoded.sid, user: decoded.sub, revokedAt: null }).select("_id").lean();
  const user = session
    ? await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id").lean() as unknown as { _id: unknown } | null
    : null;
  return user ? String(user._id) : null;
};

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuth();
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return NextResponse.json({ message: "Invalid pack" }, { status: 400 });
  const limit = await rateLimit("stickers:install:" + userId, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429 });
  const pack = await StickerPackSchema.findById(id).select("_id").lean();
  if (!pack) return NextResponse.json({ message: "Pack not found" }, { status: 404 });
  await UserStickerPackSchema.updateOne({ user: userId, packId: id }, { $setOnInsert: { user: userId, packId: id, installedAt: new Date() } }, { upsert: true });
  return NextResponse.json({ success: true, installed: true, packId: id });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuth();
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return NextResponse.json({ message: "Invalid pack" }, { status: 400 });
  const limit = await rateLimit("stickers:remove:" + userId, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429 });
  await UserStickerPackSchema.deleteOne({ user: userId, packId: id });
  return NextResponse.json({ success: true, installed: false, packId: id });
}
