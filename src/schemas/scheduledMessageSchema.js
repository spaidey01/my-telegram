import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  sender: { type: Schema.ObjectId, ref: "User", required: true, index: true },
  room: { type: Schema.ObjectId, ref: "Room", required: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  scheduledFor: { type: Date, required: true, index: true },
  status: { type: String, enum: ["pending", "processing", "sent", "failed", "cancelled"], default: "pending", index: true },
  processingAt: { type: Date, default: null, index: true },
  attemptCount: { type: Number, default: 0, min: 0 },
  sentAt: { type: Date, default: null },
  error: { type: String, default: null, maxlength: 500 },
}, { timestamps: true });
schema.index({ status: 1, scheduledFor: 1 });
export default mongoose.models.ScheduledMessage || mongoose.model("ScheduledMessage", schema);
