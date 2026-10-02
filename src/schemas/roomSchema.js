import mongoose, { Schema } from "mongoose";

const schema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    avatar: { type: String, default: "" },
    type: {
      type: String,
      enum: ["group", "private", "channel"],
      required: true,
    },
    admins: [{ type: Schema.ObjectId, ref: "User", required: true }],
    participants: [{ type: Schema.ObjectId, ref: "User", required: true }],
    creator: { type: Schema.ObjectId, ref: "User" },
    medias: [{ type: Schema.ObjectId, ref: "Media", required: true }],
    locations: [{ type: Schema.ObjectId, ref: "Location", required: true }],
    lastMessageId: { type: Schema.ObjectId, ref: "Message", default: null },
    lastMessageAt: { type: Date, default: null },
    link: { type: String, trim: true, maxlength: 500, unique: true, sparse: true },
    biography: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

schema.index({ participants: 1 });
schema.index({ type: 1, participants: 1 });
schema.index({ link: 1 }, { unique: true, sparse: true });

const RoomSchema = mongoose.models.Room || mongoose.model("Room", schema);
export default RoomSchema;
