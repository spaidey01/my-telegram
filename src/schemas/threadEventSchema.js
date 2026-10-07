import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  actor: { type: Schema.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["mention", "reaction", "call", "system"], required: true },
  room: { type: Schema.ObjectId, ref: "Room", required: true, index: true },
  message: { type: Schema.ObjectId, ref: "Message", default: null },
  data: { type: Schema.Types.Mixed, default: {} },
  readBy: { type: [Schema.ObjectId], ref: "User", default: [] },
}, { timestamps: true });

schema.index({ room: 1, createdAt: -1 });
schema.index({ actor: 1, type: 1, createdAt: -1 });
schema.index({ "data.targetUser": 1, type: 1, createdAt: -1 });

export default mongoose.models.ThreadEvent || mongoose.model("ThreadEvent", schema);
