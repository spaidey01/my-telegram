import { NextResponse } from "next/server";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { rateLimit } from "@/utils/rateLimit";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg","image/png","image/gif","image/webp","audio/ogg","audio/mpeg","audio/wav","audio/flac","audio/webm","audio/mp4","video/mp4","video/webm","video/quicktime","video/ogg","application/pdf","application/zip","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.presentationml.presentation","text/plain","text/csv","application/json"]);

const userIdFromCookie = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  return decoded && typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.sv === "number" ? { id: String(decoded.sub), sv: decoded.sv } : null;
};

const s3 = () => new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
});

export async function POST(req: Request) {
  try {
    const auth = await userIdFromCookie();
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    await connectToDB();
    const sessionUser = await UserSchema.findOne({ _id: auth.id, sessionVersion: auth.sv }).select("_id").lean();
    if (!sessionUser) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const userId = auth.id;
    const limit = await rateLimit("presign:" + userId, 20, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { message: "Too many uploads. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    const body = await req.json();
    const purpose = body?.purpose === "sticker" ? "sticker" : "file";
    const contentType = typeof body?.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
    const size = Number(body?.size);

    if (!contentType || !Number.isFinite(size) || size <= 0 || size > (purpose === "sticker" ? 512 * 1024 : MAX_FILE_SIZE)) {
      return NextResponse.json({ message: "Invalid file" }, { status: 400 });
    }

    if (purpose === "sticker" && !new Set(["image/png", "image/webp", "image/gif"]).has(contentType)) return NextResponse.json({ message: "Sticker type not allowed" }, { status: 415 });

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json({ message: "File type not allowed" }, { status: 415 });
    }

    const bucket = process.env.S3_BUCKET_NAME;
    if (!bucket || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT) {
      return NextResponse.json({ message: "Storage is not configured" }, { status: 500 });
    }

    const prefix = purpose === "sticker" ? "stickers" : contentType.startsWith("image/") ? "images" : contentType.startsWith("audio/") ? "voices" : "files";
    const key = `${prefix}/${userId}/${randomUUID()}`;
    const client = s3();
    const post = await createPresignedPost(client, {
      Bucket: bucket,
      Key: key,
      Fields: { "Content-Type": contentType, key },
      Conditions: [
        ["content-length-range", 1, purpose === "sticker" ? 512 * 1024 : MAX_FILE_SIZE],
        ["eq", "$Content-Type", contentType],
      ],
      Expires: 60,
    });

    return NextResponse.json({
      uploadUrl: post.url,
      uploadMethod: "POST",
      uploadFields: post.fields,
      key,
    });
  } catch (error) {
    console.error("presign:", error);
    return NextResponse.json({ message: "Unable to prepare upload" }, { status: 500 });
  }
}
