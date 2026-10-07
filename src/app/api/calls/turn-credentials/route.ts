import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import tokenDecoder from "@/utils/TokenDecoder";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import SessionSchema from "@/schemas/sessionSchema";
import { getRequestIp, rateLimit } from "@/utils/rateLimit";
import { buildTurnIceServers } from "@/utils/turnCredentials";
import mongoose from "mongoose";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
};

export async function GET(req: Request) {
  const ipLimit = await rateLimit("turn-credentials:ip:" + getRequestIp(req), 10, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { message: "Too many requests. Try again later." },
      { status: 429, headers: { ...noStoreHeaders, "Retry-After": String(ipLimit.retryAfter) } },
    );
  }

  const token = (await cookies()).get("token")?.value;
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  const decoded = tokenDecoder(token);
  if (!decoded || typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.sv !== "number" || typeof decoded.sid !== "string" || !mongoose.isValidObjectId(decoded.sub) || !mongoose.isValidObjectId(decoded.sid)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  await connectToDB();
  const session = await SessionSchema.findOne({ _id: decoded.sid, user: decoded.sub, revokedAt: null }).select("_id").lean();
  const user = session ? await UserSchema.findOne({ _id: decoded.sub, sessionVersion: decoded.sv })
    .select("_id sessionVersion")
    .lean();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  }

  if (!process.env.TURN_URL) {
    return NextResponse.json(
      { message: "TURN service is not configured" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  try {
    const config = buildTurnIceServers(decoded.sub);
    return NextResponse.json(config, { status: 200, headers: noStoreHeaders });
  } catch (error) {
    console.error("TURN credential configuration error:", error);
    return NextResponse.json(
      { message: "TURN service is unavailable" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
