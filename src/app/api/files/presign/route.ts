import { NextResponse } from "next/server";
import { S3 } from "aws-sdk";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";
import { rateLimit } from "@/utils/rateLimit";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const userIdFromCookie = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? tokenDecoder(token) : false;
  return decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? String(decoded.sub) : null;
};

const s3 = () =>
  new S3({
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
    endpoint: process.env.S3_ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: "v4",
  });

export async function POST(req: Request) {
  try {
    const userId = await userIdFromCookie();
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const limit = rateLimit("presign:" + userId, 20, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { message: "Too many uploads. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    const body = await req.json();
    const contentType = typeof body?.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
    const size = Number(body?.size);

    if (!contentType || !Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return NextResponse.json({ message: "Invalid file" }, { status: 400 });
    }

    if (!contentType.startsWith("image/") && !contentType.startsWith("audio/")) {
      return NextResponse.json({ message: "File type not allowed" }, { status: 415 });
    }

    const bucket = process.env.S3_BUCKET_NAME;
    if (!bucket || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT) {
      return NextResponse.json({ message: "Storage is not configured" }, { status: 500 });
    }

    const key = `${contentType.startsWith("image/") ? "images" : "voices"}/${userId}/${randomUUID()}`;
    const client = s3();
    const post = client.createPresignedPost({
      Bucket: bucket,
      Fields: { "Content-Type": contentType },
      Conditions: [
        ["content-length-range", 1, MAX_FILE_SIZE],
        ["eq", "$Content-Type", contentType],
      ],
      Expires: 600,
      Key: key,
    });

    const downloadUrl = await client.getSignedUrlPromise("getObject", {
      Bucket: bucket,
      Key: key,
      Expires: 7 * 24 * 60 * 60,
    });

    return NextResponse.json({
      uploadUrl: post.url,
      uploadMethod: "POST",
      uploadFields: post.fields,
      downloadUrl,
      key,
    });
  } catch (error) {
    console.error("presign:", error);
    return NextResponse.json({ message: "Unable to prepare upload" }, { status: 500 });
  }
}
