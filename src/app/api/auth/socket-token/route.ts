import { cookies } from "next/headers";
type AuthSession={_id:unknown};
import { NextResponse } from "next/server";
import tokenDecoder from "@/utils/TokenDecoder";
import { socketTokenGenerator } from "@/utils/TokenGenerator";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { getRequestIp, rateLimit } from "@/utils/rateLimit";
import SessionSchema from "@/schemas/sessionSchema";

export async function GET(req: Request) {
  const ipLimit = await rateLimit("socket-token:ip:" + getRequestIp(req), 30, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { message: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } },
    );
  }

  const token = (await cookies()).get("token")?.value;
  if (!token) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const decoded = tokenDecoder(token);
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectToDB();
  const session = await SessionSchema.findOne({ _id: decoded.sid, user: decoded.sub, revokedAt: null }) .lean().then((value)=>value as unknown as AuthSession | null);
  const user = session ? await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id sessionVersion").lean().then((value)=>value) : null;
  if (session) await SessionSchema.updateOne({ _id: session._id }, { $set: { lastActiveAt: new Date() } });
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const sessionVersion = Number((user as { sessionVersion?: number }).sessionVersion ?? decoded.sv);
  return NextResponse.json({
    token: socketTokenGenerator(decoded.sub, sessionVersion, decoded.sid),
  }, { status: 200 });
}
