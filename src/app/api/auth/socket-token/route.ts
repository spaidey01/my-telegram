import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import tokenDecoder from "@/utils/TokenDecoder";
import { socketTokenGenerator } from "@/utils/TokenGenerator";

export async function GET() {
  const token = (await cookies()).get("token")?.value;
  if (!token) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const decoded = tokenDecoder(token) as { sub?: string } | false;
  if (!decoded || !decoded.sub) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ token: socketTokenGenerator(decoded.sub) }, { status: 200 });
}
