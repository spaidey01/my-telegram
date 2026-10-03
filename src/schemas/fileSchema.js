import mongoose, { Schema } from "mongoose";

const schema = new Schema(
  {
    key: { type: String, required: true, unique: true, maxlength: 200 },
    owner: { type: Schema.ObjectId, ref: "User", required: true, index: true },
    contentType: { type: String, required: true },
  },
  { timestamps: true }
);

const FileSchema = mongoose.models.VerifiedFile || mongoose.model("VerifiedFile", schema);
export default FileSchema;
