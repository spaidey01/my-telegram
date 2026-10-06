import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { DEFAULT_PRIVACY_SETTINGS, PRIVACY_KEYS, PRIVACY_VALUES, normalizePrivacySettings } from "@/utils/privacy";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

const secret = process.env.secretKey;

const getUserID = async () => {
  if (!secret) return null;
  const token = (await cookies()).get("token")?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
};

export const GET = async () => {
  const userID = await getUserID();
  if (!userID) return Response.json({ message: "Unauthorized" }, { status: 401 });
  await connectToDB();
  const user = await UserSchema.findById(userID).select("privacySettings").lean();
  if (!user) return Response.json({ message: "User not found" }, { status: 404 });
  return Response.json(normalizePrivacySettings((user as any).privacySettings));
};

export const PATCH = async (req: Request) => {
  const userID = await getUserID();
  if (!userID) return Response.json({ message: "Unauthorized" }, { status: 401 });
  try {
    await connectToDB();
    const body = await req.json();
    const current = normalizePrivacySettings((await UserSchema.findById(userID).select("privacySettings").lean() as any)?.privacySettings);
    const patch = body && typeof body === "object" ? body : {};
    const next = { ...current };
    for (const key of PRIVACY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        if (!PRIVACY_VALUES.includes(patch[key])) return Response.json({ message: "Invalid privacy value" }, { status: 400 });
        next[key] = patch[key];
      }
    }
    const updated = await UserSchema.findByIdAndUpdate(userID, { $set: { privacySettings: next } }, { new: true }).select("privacySettings").lean();
    return Response.json(normalizePrivacySettings((updated as any)?.privacySettings || DEFAULT_PRIVACY_SETTINGS));
  } catch {
    return Response.json({ message: "Unable to update privacy settings" }, { status: 500 });
  }
};
