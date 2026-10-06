import StickerSchema from "@/schemas/stickerSchema";
import StickerPackSchema from "@/schemas/stickerPackSchema";
import UserStickerPackSchema from "@/schemas/userStickerPackSchema";

export const stickerFilePrefix = "stickers";

export const getInstalledStickerPackIds = async (userId: string) => {
  const rows = await UserStickerPackSchema.find({ user: userId }).select("packId").lean() as unknown as { packId: { toString(): string } }[];
  return rows.map((row) => String(row.packId));
};

export const canUseSticker = async (userId: string, stickerId: string, packId: string) => {
  const sticker = await StickerSchema.findOne({ _id: stickerId, packId }).select("_id packId file mimeType emoji").lean() as unknown as { _id: unknown; packId: unknown; file: string; mimeType: string; emoji: string } | null;
  if (!sticker) return null;
  const pack = await StickerPackSchema.findById(packId).select("_id owner").lean() as unknown as { _id: unknown; owner: unknown } | null;
  if (!pack) return null;
  if (String(pack.owner) !== userId) {
    const installed = await UserStickerPackSchema.exists({ user: userId, packId });
    if (!installed) return null;
  }
  return sticker;
};
