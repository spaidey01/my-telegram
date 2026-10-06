import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  user: { type: Schema.ObjectId, ref: "User", required: true, index: true },
  device: { type: String, required: true, maxlength: 120 },
  ip: { type: String, required: true, maxlength: 120 },
  userAgent: { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now, index: true },
  revokedAt: { type: Date, default: null, index: true },
}, { timestamps: false });
schema.index({ user: 1, revokedAt: 1, lastActiveAt: -1 });
export default mongoose.models.Session || mongoose.model("Session", schema);
