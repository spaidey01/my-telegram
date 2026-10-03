import mongoose, { Schema } from "mongoose";

export const schema = new Schema(
  {
    sender: { type: mongoose.Types.ObjectId, required: true, ref: "User" },
    message: { type: String, maxlength: 10000, default: "" },
    seen: [{ type: Schema.ObjectId, ref: "User" }],
    readTime: { type: Date, default: null },
    replays: [{ type: Schema.ObjectId, ref: "Message" }],
    roomID: { type: Schema.ObjectId, ref: "Room", required: true },
    replayedTo: {
      type: { message: String, msgID: String, username: String },
      default: null,
    },
    isEdited: { type: Boolean, default: false },
    hideFor: [{ type: Schema.ObjectId, ref: "User" }],
    pinnedAt: { type: Date, default: null },
    voiceData: {
      type: {
        src: { type: String, required: true, maxlength: 2048 },
        duration: { type: Number, required: true, min: 0, max: 3600 },
        playedBy: [{ type: String, maxlength: 100 }],
      },
      default: null,
    },
    attachmentData: { type: { src:{type:String,required:true,maxlength:2048}, name:{type:String,required:true,maxlength:255}, type:{type:String,required:true,maxlength:120}, size:{type:Number,required:true,min:1,max:25*1024*1024} }, default:null },
    stickerData: { type: { emoji:{type:String,required:true,maxlength:16} }, default:null },
    tempId: { type: String, unique: true, sparse: true, maxlength: 200 },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "sent",
    },
  },
  { timestamps: true, strictPopulate: false }
);

schema.index({ roomID: 1, createdAt: -1, _id: -1 });
schema.index({ roomID: 1, sender: 1, createdAt: -1 });
schema.index({ roomID: 1, message: 1 });

const MessageSchema =
  mongoose.models.Message || mongoose.model("Message", schema);
export default MessageSchema;
