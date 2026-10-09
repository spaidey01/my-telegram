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
    privateKey: { type: String, unique: true, sparse: true, index: true },
    creator: { type: Schema.ObjectId, ref: "User" },
    medias: [{ type: Schema.ObjectId, ref: "Media", required: true }],
    locations: [{ type: Schema.ObjectId, ref: "Location", required: true }],
    lastMessageId: { type: Schema.ObjectId, ref: "Message", default: null },
    lastMessageAt: { type: Date, default: null },
    link: { type: String, trim: true, maxlength: 500, sparse: true },
    biography: { type: String, default: "", maxlength: 1000 },
    visibility: { type: String, enum: ["private", "public"], default: "public" },
    groupPermissions: {
      sendMessages: { type: Boolean, default: true }, sendMedia: { type: Boolean, default: true },
      sendStickers: { type: Boolean, default: true }, sendLinks: { type: Boolean, default: true },
      addMembers: { type: Boolean, default: true }, pinMessages: { type: Boolean, default: true },
      changeInfo: { type: Boolean, default: false }, manageMembers: { type: Boolean, default: false },
    },
    memberPermissions: { type: Map, of: new Schema({
      sendMessages: { type: Boolean }, sendMedia: { type: Boolean }, sendStickers: { type: Boolean },
      sendLinks: { type: Boolean }, addMembers: { type: Boolean }, pinMessages: { type: Boolean },
      changeInfo: { type: Boolean }, manageMembers: { type: Boolean },
    }, { _id: false }), default: {} },
    bannedUsers: [{ type: Schema.ObjectId, ref: "User" }],
    restrictedUsers: [{ type: Schema.ObjectId, ref: "User" }],
    mutedUsers: [{ type: Schema.ObjectId, ref: "User" }],
    allowedReactions: { type: [String], default: [] },
    inviteToken: { type: String, default: undefined, unique: true, sparse: true },
    channelRoles: { type: Map, of: { type: String, enum: ["owner", "admin", "editor", "moderator"] }, default: {} },
  },
  { timestamps: true }
);

schema.index({ participants: 1 });
schema.index({ type: 1, participants: 1 });
schema.index({ link: 1 }, { unique: true, sparse: true });

const RoomSchema = mongoose.models.Room || mongoose.model("Room", schema);
export default RoomSchema;
