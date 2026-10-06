import mongoose, { Schema } from "mongoose";

export const schema = new Schema(
  {
    name: { type: String, required: true, minLength: 3, maxLength: 20, trim: true },
    lastName: { type: String, default: "", maxLength: 20, trim: true },
    username: { type: String, required: true, minLength: 3, maxLength: 20, unique: true, trim: true, lowercase: true },
    phone: { type: String, required: true, unique: true, trim: true },
    avatar: { type: String, default: "" },
    biography: { type: String, default: "", maxLength: 70 },
    type: { type: String, enum: ["private"], default: "private" },
    status: { type: String, enum: ["online", "offline"], default: "offline" },
    lastSeenAt: { type: Date, default: null },
    password: { type: String, required: true, select: false },
    sessionVersion: { type: Number, default: 0, min: 0 },
    roomMessageTrack: { type: [{ roomId: String, scrollPos: Number }], default: [] },
  },
  { timestamps: true }
);

schema.index({ username: 1 }, { unique: true });
schema.index({ phone: 1 }, { unique: true });

const UserSchema = mongoose.models.User || mongoose.model("User", schema);
export default UserSchema;
