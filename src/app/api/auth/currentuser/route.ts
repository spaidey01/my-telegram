import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import { getRequestIp, rateLimit } from "@/utils/rateLimit";
import SessionSchema from "@/schemas/sessionSchema";

export const POST = async (req: Request) => {
  const limit = await rateLimit("currentuser:ip:" + getRequestIp(req), 60, 60_000);
  if (!limit.allowed) return Response.json({ message: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  try {
    await connectToDB();
    const cookieToken = (await cookies()).get("token")?.value;
    if (!cookieToken) return Response.json({ message: "You are not logged in" }, { status: 401 });

    const verifiedToken = tokenDecoder(cookieToken);
    if (!verifiedToken || typeof verifiedToken !== "object" || typeof verifiedToken.sub !== "string" || typeof verifiedToken.sv !== "number" || typeof verifiedToken.sid !== "string") {
      (await cookies()).delete("token");
      return Response.json({ message: "Invalid session" }, { status: 401 });
    }

    const session = await SessionSchema.findOne({ _id: verifiedToken.sid, user: verifiedToken.sub, revokedAt: null }).lean();
    const userData = session ? await UserSchema.findOne({ _id: verifiedToken.sub, sessionVersion: verifiedToken.sv }).select("-password").lean() : null;
    if (session) await SessionSchema.updateOne({ _id: session._id }, { $set: { lastActiveAt: new Date() } });

    if (!userData) {
      (await cookies()).delete("token");
      return Response.json({ message: "Invalid session" }, { status: 401 });
    }
    return Response.json(userData, { status: 200 });
  } catch (err) {
    console.error("currentuser:", err);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
};
