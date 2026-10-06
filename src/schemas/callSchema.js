import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  caller: { type: Schema.ObjectId, ref: "User", required: true, index: true },
  receiver: { type: Schema.ObjectId, ref: "User", required: true, index: true },
  roomID: { type: Schema.ObjectId, ref: "Room", required: true, index: true },
  type: { type: String, enum: ["audio", "video"], required: true },
  status: { type: String, enum: ["missed", "rejected", "cancelled", "completed", "failed"], required: true },
  startedAt: { type: Date, required: true, index: true },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ caller: 1, createdAt: -1 });
schema.index({ receiver: 1, createdAt: -1 });
export default mongoose.models.Call || mongoose.model("Call", schema);
