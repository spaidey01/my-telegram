import { isSafeBrowserRequest } from "@/utils/csrf";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import mongoose from "mongoose";
import tokenDecoder from "@/utils/TokenDecoder";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import UserStickerPackSchema from "@/schemas/userStickerPackSchema";
import StickerSchema from "@/schemas/stickerSchema";
import { rateLimit } from "@/utils/rateLimit";
import SessionSchema from "@/schemas/sessionSchema";

const getAuth = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string" || !mongoose.isValidObjectId(decoded.sub) || !mongoose.isValidObjectId(decoded.sid)) return null;
  await connectToDB();
  const session = await SessionSchema.findOne({ _id: decoded.sid, user: decoded.sub, revokedAt: null }).select("_id").lean();
  const user = session ? await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id").lean() as unknown as { _id: unknown } | null : null;
  return user ? String(user._id) : null;
};

export async function GET() {
  const userId = await getAuth();
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const rows = await UserStickerPackSchema.find({ user: userId }).select("recentStickerIds favoriteStickerIds").lean() as unknown as { recentStickerIds: unknown[]; favoriteStickerIds: unknown[] }[];
  return NextResponse.json({
    recentStickerIds: [...new Set(rows.flatMap((row) => row.recentStickerIds.map(String)))].slice(0, 50),
    favoriteStickerIds: [...new Set(rows.flatMap((row) => row.favoriteStickerIds.map(String)))].slice(0, 100),
  });
}

export async function PATCH(req: Request) {
  if (!isSafeBrowserRequest(req)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  const userId = await getAuth();
  if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const limit = await rateLimit("stickers:prefs:" + userId, 60, 60_000);
  if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429 });
  const body = await req.json();
  const type = body?.type === "recent" || body?.type === "favorite" ? body.type : "";
  const stickerId = typeof body?.stickerId === "string" ? body.stickerId : "";
  if (!type || !mongoose.isValidObjectId(stickerId)) return NextResponse.json({ message: "Invalid sticker" }, { status: 400 });

  const sticker = await StickerSchema.findById(stickerId).select("_id packId").lean() as unknown as { _id: { toString(): string }; packId: { toString(): string } } | null;
  if (!sticker) return NextResponse.json({ message: "Sticker not found" }, { status: 404 });
  const installed = await UserStickerPackSchema.exists({ user: userId, packId: sticker.packId });
  const packOwned = await (await import("@/schemas/stickerPackSchema")).default.exists({ _id: sticker.packId, owner: userId });
  if (!installed && !packOwned) return NextResponse.json({ message: "Sticker pack is not installed" }, { status: 403 });

  const rows = await UserStickerPackSchema.find({ user: userId }) as unknown as { packId: { toString(): string }; recentStickerIds: { toString(): string }[]; favoriteStickerIds: { toString(): string }[]; save: () => Promise<void> }[];
  let row = rows.find((item) => String(item.packId) === String(sticker.packId));
  if (!row) {
    row = await UserStickerPackSchema.create({ user: userId, packId: sticker.packId }) as unknown as (typeof rows)[number];
  }
  if (!row) return NextResponse.json({ message: "Unable to update sticker preferences" }, { status: 500 });

  if (type === "recent") {
    row.recentStickerIds = [sticker._id, ...row.recentStickerIds.filter((id) => String(id) !== String(sticker._id))].slice(0, 50);
  } else {
    const exists = row.favoriteStickerIds.some((id) => String(id) === String(sticker._id));
    row.favoriteStickerIds = exists
      ? row.favoriteStickerIds.filter((id) => String(id) !== String(sticker._id))
      : [sticker._id, ...row.favoriteStickerIds].slice(0, 100);
  }
  await row.save();
  return NextResponse.json({ success: true, type, stickerId, favorite: type === "favorite" ? row.favoriteStickerIds.some((id) => String(id) === stickerId) : undefined });
}
