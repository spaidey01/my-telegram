import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import tokenDecoder from "@/utils/TokenDecoder";
import { socketTokenGenerator } from "@/utils/TokenGenerator";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";

export async function GET() {
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
