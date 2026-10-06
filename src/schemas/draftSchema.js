import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  user: { type: Schema.ObjectId, ref: "User", required: true, index: true },
  room: { type: Schema.ObjectId, ref: "Room", required: true, index: true },
  message: { type: String, default: "", maxlength: 10000 },
  payload: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
schema.index({ user: 1, room: 1 }, { unique: true });
export default mongoose.models.Draft || mongoose.model("Draft", schema);
