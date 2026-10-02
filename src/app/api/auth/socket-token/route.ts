import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import tokenDecoder from "@/utils/TokenDecoder";
import { socketTokenGenerator } from "@/utils/TokenGenerator";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { getRequestIp, rateLimit } from "@/utils/rateLimit";

export async function GET(req: Request) {
  const ipLimit = rateLimit("socket-token:ip:" + getRequestIp(req), 30, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { message: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } },
    );
  }

  const token = (await cookies()).get("token")?.value;
  if (!token) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const decoded = tokenDecoder(token);
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectToDB();
  const user = await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv }).select("_id sessionVersion").lean();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const sessionVersion = Number((user as { sessionVersion?: number }).sessionVersion ?? decoded.sv);
  return NextResponse.json({
    token: socketTokenGenerator(decoded.sub, sessionVersion),
  }, { status: 200 });
}
