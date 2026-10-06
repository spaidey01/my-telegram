import mongoose, { Schema } from "mongoose";

export const schema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    thumbnail: { type: String, default: "", maxlength: 2048 },
    owner: { type: Schema.ObjectId, ref: "User", required: true, index: true },
    stickers: [{ type: Schema.ObjectId, ref: "Sticker" }],
  },
  { timestamps: true },
);

schema.index({ owner: 1, name: 1 }, { unique: true });

const StickerPackSchema = mongoose.models.StickerPack || mongoose.model("StickerPack", schema);
export default StickerPackSchema;
