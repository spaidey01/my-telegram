import { isSafeBrowserRequest } from "@/utils/csrf";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { DEFAULT_PRIVACY_SETTINGS, PRIVACY_KEYS, PRIVACY_VALUES, normalizePrivacySettings } from "@/utils/privacy";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import User from "@/models/user";
import SessionSchema from "@/schemas/sessionSchema";
import mongoose from "mongoose";

const getUserID = async () => {
  const token = (await cookies()).get("token")?.value;
  if (!token) return null;
  const decoded = tokenDecoder(token);
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string") return null;
  if (!mongoose.isValidObjectId(decoded.sub) || !mongoose.isValidObjectId(decoded.sid)) return null;
  return { id: decoded.sub, sv: decoded.sv, sid: decoded.sid };
};

export const GET = async () => {
  const auth = await getUserID();
  if (!auth) return Response.json({ message: "Unauthorized" }, { status: 401 });
  await connectToDB();
  const session = await SessionSchema.findOne({ _id: auth.sid, user: auth.id, revokedAt: null }).select("_id").lean();
  const current = session ? await UserSchema.findOne({ _id: auth.id, sessionVersion: auth.sv }).select("_id").lean() : null;
  if (!current) return Response.json({ message: "Unauthorized" }, { status: 401 });
  const user = await UserSchema.findById(auth.id).select("privacySettings").lean();
  if (!user) return Response.json({ message: "User not found" }, { status: 404 });
  return Response.json(normalizePrivacySettings((user as unknown as Pick<User, "privacySettings">).privacySettings));
};

export const PATCH = async (req: Request) => {
  if (!isSafeBrowserRequest(req)) return Response.json({ message: "Forbidden" }, { status: 403 });
  const auth = await getUserID();
  if (!auth) return Response.json({ message: "Unauthorized" }, { status: 401 });
  try {
    await connectToDB();
    const body = await req.json();
    const session = await SessionSchema.findOne({ _id: auth.sid, user: auth.id, revokedAt: null }).select("_id").lean();
    const currentUser = session ? await UserSchema.findOne({ _id: auth.id, sessionVersion: auth.sv }).select("_id privacySettings").lean() : null;
    if (!currentUser) return Response.json({ message: "Unauthorized" }, { status: 401 });
    const current = normalizePrivacySettings((await UserSchema.findById(auth.id).select("privacySettings").lean() as unknown as Pick<User, "privacySettings">)?.privacySettings);
    const patch = body && typeof body === "object" ? body : {};
    const next = { ...current };
    for (const key of PRIVACY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        if (!PRIVACY_VALUES.includes(patch[key])) return Response.json({ message: "Invalid privacy value" }, { status: 400 });
        next[key] = patch[key];
      }
    }
    const updated = await UserSchema.findByIdAndUpdate(auth.id, { $set: { privacySettings: next } }, { new: true }).select("privacySettings").lean();
    return Response.json(normalizePrivacySettings((updated as unknown as Pick<User, "privacySettings">)?.privacySettings || DEFAULT_PRIVACY_SETTINGS));
  } catch {
    return Response.json({ message: "Unable to update privacy settings" }, { status: 500 });
  }
};
