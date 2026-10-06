import mongoose, { Schema } from "mongoose";

export const schema = new Schema(
  {
    user: { type: Schema.ObjectId, ref: "User", required: true, index: true },
    packId: { type: Schema.ObjectId, ref: "StickerPack", required: true, index: true },
    installedAt: { type: Date, default: Date.now },
    recentStickerIds: [{ type: Schema.ObjectId, ref: "Sticker" }],
    favoriteStickerIds: [{ type: Schema.ObjectId, ref: "Sticker" }],
  },
  { timestamps: true },
);

schema.index({ user: 1, packId: 1 }, { unique: true });

const UserStickerPackSchema = mongoose.models.UserStickerPack || mongoose.model("UserStickerPack", schema);
export default UserStickerPackSchema;
