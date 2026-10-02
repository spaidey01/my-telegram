import { NextResponse } from "next/server";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";
import { rateLimit } from "@/utils/rateLimit";

const MAX_SNIFF_BYTES = 512;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "audio/ogg", "audio/mpeg", "audio/wav", "audio/flac"]);

const s3 = () => new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
});

const isMagicValid = (bytes: Uint8Array, contentType: string) => {
  const b = (i: number) => bytes[i] ?? -1;
  if (contentType === "image/jpeg") return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (contentType === "image/png") return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  if (contentType === "image/gif") return b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46;
  if (contentType === "image/webp") return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  if (contentType === "audio/ogg") return b(0) === 0x4f && b(1) === 0x67 && b(2) === 0x67 && b(3) === 0x53;
  if (contentType === "audio/wav") return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x41 && b(10) === 0x56 && b(11) === 0x45;
  if (contentType === "audio/flac") return b(0) === 0x66 && b(1) === 0x4c && b(2) === 0x41 && b(3) === 0x43;
  if (contentType === "audio/mpeg") return (b(0) === 0xff && (b(1) & 0xe0) === 0xe0) || (b(0) === 0x49 && b(1) === 0x44 && b(2) === 0x33);
  return true;
};

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get("token")?.value;
    const decoded = token ? tokenDecoder(token) : false;
    const userId = decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? String(decoded.sub) : null;
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const limit = rateLimit("file-verify:" + userId, 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429 });

    const body = await req.json();
    const key = typeof body?.key === "string" ? body.key : "";
    const contentType = typeof body?.contentType === "string" ? body.contentType.toLowerCase() : "";
    const ownerPrefix = key.split("/")[1];
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return NextResponse.json({ message: "File type not allowed" }, { status: 415 });
    if (!/^(images|voices)\/[a-fA-F0-9]{24}\/[0-9a-f-]{36}$/.test(key) || ownerPrefix !== userId) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const bucket = process.env.S3_BUCKET_NAME;
    if (!bucket || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT) {
      return NextResponse.json({ message: "Storage is not configured" }, { status: 500 });
    }

    const object = await s3().send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${MAX_SNIFF_BYTES - 1}`,
    }));
    if (!object.Body) return NextResponse.json({ message: "Invalid file" }, { status: 415 });
    const bytes = await object.Body.transformToByteArray();
    if (!isMagicValid(bytes, contentType)) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return NextResponse.json({ message: "File content does not match its type" }, { status: 415 });
    }

    const accessUrl = `/api/files/access?key=${encodeURIComponent(key)}`;
    return NextResponse.json({ success: true, downloadUrl: accessUrl });
  } catch (error) {
    console.error("verify file:", error);
    return NextResponse.json({ message: "File verification failed" }, { status: 415 });
  }
}
