import mongoose, { Schema } from "mongoose";

export const schema = new Schema(
  {
    packId: { type: Schema.ObjectId, ref: "StickerPack", required: true, index: true },
    file: { type: String, required: true, maxlength: 2048 },
    mimeType: { type: String, required: true, enum: ["image/png", "image/webp", "image/gif"], maxlength: 120 },
    emoji: { type: String, required: true, maxlength: 16 },
    sortOrder: { type: Number, required: true, min: 0, max: 10000, default: 0 },
  },
  { timestamps: true },
);

schema.index({ packId: 1, sortOrder: 1, _id: 1 });

const StickerSchema = mongoose.models.Sticker || mongoose.model("Sticker", schema);
export default StickerSchema;
