import { NextResponse } from "next/server";
import { S3 } from "aws-sdk";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";

const userIdFromCookie = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  return decoded && typeof decoded === "object" && "sub" in decoded ? String(decoded.sub) : null;
};
const s3 = () => new S3({ accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY, endpoint: process.env.S3_ENDPOINT, s3ForcePathStyle: true, signatureVersion: "v4" });

export async function POST(req: Request) {
  try {
    const userId = await userIdFromCookie();
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const contentType = typeof body?.contentType === "string" ? body.contentType : "";
    const size = Number(body?.size);
    if (!contentType || !Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) return NextResponse.json({ message: "Invalid file" }, { status: 400 });
    if (!contentType.startsWith("image/") && !contentType.startsWith("audio/")) return NextResponse.json({ message: "File type not allowed" }, { status: 415 });
    const bucket = process.env.S3_BUCKET_NAME;
    if (!bucket || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) return NextResponse.json({ message: "Storage is not configured" }, { status: 500 });
    const key = `${contentType.startsWith("image/") ? "images" : "voices"}/${userId}/${randomUUID()}`;
    const client = s3();
    const uploadUrl = await client.getSignedUrlPromise("putObject", { Bucket: bucket, Key: key, ContentType: contentType, Expires: 600 });
    const downloadUrl = await client.getSignedUrlPromise("getObject", { Bucket: bucket, Key: key, Expires: 7 * 24 * 60 * 60 });
    return NextResponse.json({ uploadUrl, downloadUrl, key });
  } catch (error) {
    console.error("presign:", error);
    return NextResponse.json({ message: "Unable to prepare upload" }, { status: 500 });
  }
}