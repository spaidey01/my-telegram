import { NextResponse } from "next/server";
import net from "node:net";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";
import { rateLimit } from "@/utils/rateLimit";

const MAX_SNIFF_BYTES = 512;
const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "audio/ogg", "audio/mpeg", "audio/wav", "audio/flac", "audio/webm"]);

const s3 = () => new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
});

const scanWithClamAV = (bytes: Uint8Array) => new Promise<boolean>((resolve, reject) => {
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT || 3310);
  if (!host) return resolve(true);

  const socket = net.createConnection({ host, port });
  let response = "";
  let settled = false;
  const finish = (value: boolean) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(value);
  };
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    reject(error);
  };

  socket.setTimeout(15_000);
  socket.on("connect", () => {
    socket.write("zINSTREAM\\0");
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = Buffer.from(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(chunk.length, 0);
      socket.write(header);
      socket.write(chunk);
    }
    socket.write(Buffer.alloc(4));
  });
  socket.on("data", (chunk) => {
    response += chunk.toString("utf8");
    if (response.includes("FOUND")) finish(false);
    else if (response.includes("OK")) finish(true);
  });
  socket.on("timeout", () => fail(new Error("ClamAV timeout")));
  socket.on("error", (error) => fail(error));
  socket.on("close", () => {
    if (!settled) fail(new Error("ClamAV closed connection"));
  });
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
  if (contentType === "audio/webm") return b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3;
  return false;
};

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get("token")?.value;
    const decoded = token ? tokenDecoder(token) : false;
    const userId = decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? String(decoded.sub) : null;
    const sessionVersion = decoded && typeof decoded === "object" && typeof decoded.sv === "number" ? decoded.sv : null;
    if (!userId || sessionVersion === null) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { default: UserSchema } = await import("@/schemas/userSchema");
    const { default: connectToDB } = await import("@/db");
    await connectToDB();
    const activeUser = await UserSchema.findOne({ _id: userId, sessionVersion }).select("_id").lean();
    if (!activeUser) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

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
    }));
    if (!object.Body) return NextResponse.json({ message: "Invalid file" }, { status: 415 });
    const bytes = await object.Body.transformToByteArray();
    if (bytes.length > MAX_SCAN_BYTES || !isMagicValid(bytes, contentType)) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return NextResponse.json({ message: "File content is invalid" }, { status: 415 });
    }

    const scanRequired = process.env.CLAMAV_REQUIRED === "true";
    try {
      const clean = await scanWithClamAV(bytes);
      if (!clean) {
        await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return NextResponse.json({ message: "File rejected by malware scanner" }, { status: 422 });
      }
    } catch (scanError) {
      console.error("ClamAV scan:", scanError);
      if (scanRequired) {
        await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return NextResponse.json({ message: "Malware scanner unavailable" }, { status: 503 });
      }
    }

    const accessUrl = `/api/files/access?key=${encodeURIComponent(key)}`;
    return NextResponse.json({ success: true, downloadUrl: accessUrl });
  } catch (error) {
    console.error("verify file:", error);
    return NextResponse.json({ message: "File verification failed" }, { status: 415 });
  }
}
