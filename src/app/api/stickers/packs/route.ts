import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import StickerSchema from "@/schemas/stickerSchema";
import StickerPackSchema from "@/schemas/stickerPackSchema";
import UserStickerPackSchema from "@/schemas/userStickerPackSchema";
import FileSchema from "@/schemas/fileSchema";
import { rateLimit } from "@/utils/rateLimit";

const auth = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number") return null;
  await connectToDB();
  const user = await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id").lean() as unknown as { _id: unknown } | null;
  return user ? { id: String(user._id) } : null;
};

interface StickerRecord {
  _id: { toString(): string };
  packId: { toString(): string };
  file: string;
  mimeType: string;
  emoji: string;
  sortOrder: number;
}

interface PackRecord {
  _id: { toString(): string };
  name: string;
  title: string;
  thumbnail?: string;
  owner: { toString(): string };
  stickers?: StickerRecord[];
}

const serializePack = (pack: PackRecord, installedIds: Set<string>) => ({
  _id: String(pack._id),
  name: pack.name,
  title: pack.title,
  thumbnail: pack.thumbnail || "",
  owner: String(pack.owner),
  installed: installedIds.has(String(pack._id)),
  stickers: (pack.stickers || []).map((sticker) => ({
    _id: String(sticker._id),
    packId: String(sticker.packId),
    file: sticker.file,
    mimeType: sticker.mimeType,
    emoji: sticker.emoji,
    sortOrder: sticker.sortOrder,
  })),
});

export async function GET(req: Request) {
  try {
    const current = await auth();
    if (!current) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const limit = await rateLimit("stickers:packs:" + current.id, 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429 });

    const query = new URL(req.url).searchParams.get("q")?.trim() || "";
    const filter = query ? { $or: [{ name: { $regex: query.slice(0, 64), $options: "i" } }, { title: { $regex: query.slice(0, 120), $options: "i" } }] } : {};
    const [packsRaw, installedRaw] = await Promise.all([
      StickerPackSchema.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100).populate("stickers").lean(),
      UserStickerPackSchema.find({ user: current.id }).select("packId").lean(),
    ]);
    const packs = packsRaw as unknown as PackRecord[];
    const installed = installedRaw as unknown as { packId: { toString(): string } }[];
    const installedIds = new Set(installed.map((row) => String(row.packId)));
    return NextResponse.json(packs.map((pack) => serializePack(pack, installedIds)));
  } catch (error) {
    console.error("stickers/packs GET:", error);
    return NextResponse.json({ message: "Unable to load stickers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const current = await auth();
    if (!current) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const limit = await rateLimit("stickers:create:" + current.id, 10, 60_000);
    if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429 });

    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim().toLowerCase().slice(0, 64) : "";
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
    const stickers = Array.isArray(body?.stickers) ? body.stickers.slice(0, 120) : [];
    if (!name || !title || !stickers.length) return NextResponse.json({ message: "Invalid sticker pack" }, { status: 400 });
    if (!/^[a-z0-9_-]{1,64}$/.test(name)) return NextResponse.json({ message: "Invalid pack name" }, { status: 400 });

    const prepared = [];
    for (let index = 0; index < stickers.length; index += 1) {
      const item = stickers[index];
      const file = typeof item?.file === "string" ? item.file.trim() : "";
      const mimeType = typeof item?.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "";
      const emoji = typeof item?.emoji === "string" ? item.emoji.trim() : "";
      const fileKey = (() => {
        try { return decodeURIComponent(new URL("http://local" + file).searchParams.get("key") || ""); } catch { return ""; }
      })();
      if (!file || !["image/png", "image/webp", "image/gif"].includes(mimeType) || !emoji || emoji.length > 16) return NextResponse.json({ message: "Invalid sticker" }, { status: 400 });
      if (!/^stickers\/[a-fA-F0-9]{24}\/[0-9a-f-]{36}$/.test(fileKey) || fileKey.split("/")[1] !== current.id) return NextResponse.json({ message: "Sticker file is not owned by you" }, { status: 403 });
      if (!(await FileSchema.exists({ key: fileKey, owner: current.id, contentType: mimeType }))) return NextResponse.json({ message: "Sticker file is not verified" }, { status: 403 });
      prepared.push({ file, mimeType, emoji, sortOrder: index });
    }

    const existing = await StickerPackSchema.findOne({ owner: current.id, name });
    if (existing) return NextResponse.json({ message: "Pack name already exists" }, { status: 409 });

    const pack = await StickerPackSchema.create({ name, title, thumbnail: prepared[0].file, owner: current.id, stickers: [] });
    try {
      const docs = await StickerSchema.insertMany(prepared.map((sticker) => ({ ...sticker, packId: pack._id })));
      pack.stickers = docs.map((sticker) => sticker._id);
      await pack.save();
    } catch (error) {
      await StickerPackSchema.deleteOne({ _id: pack._id });
      throw error;
    }
    await UserStickerPackSchema.create({ user: current.id, packId: pack._id });
    const populated = await StickerPackSchema.findById(pack._id).populate("stickers").lean() as unknown as PackRecord | null;
    if (!populated) return NextResponse.json({ message: "Pack creation failed" }, { status: 500 });
    return NextResponse.json(serializePack(populated, new Set([String(pack._id)])), { status: 201 });
  } catch (error) {
    console.error("stickers/packs POST:", error);
    return NextResponse.json({ message: "Unable to create sticker pack" }, { status: 500 });
  }
}
