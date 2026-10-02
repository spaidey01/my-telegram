import { NextResponse } from "next/server";
import { S3 } from "aws-sdk";
import { cookies } from "next/headers";
import tokenDecoder from "@/utils/TokenDecoder";
import { rateLimit } from "@/utils/rateLimit";

const s3 = () => new S3({ accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY, endpoint: process.env.S3_ENDPOINT, s3ForcePathStyle: true, signatureVersion: "v4" });

export async function POST(req: Request) {
  try {
    const token = (await cookies()).get("token")?.value;
    const decoded = token ? tokenDecoder(token) : false;
    const userId = decoded && typeof decoded === "object" && "sub" in decoded ? String(decoded.sub) : null;
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const limit = rateLimit("file-delete:" + userId, 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ message: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    const { fileUrl } = await req.json();
    if (typeof fileUrl !== "string") return NextResponse.json({ message: "Invalid file" }, { status: 400 });
    const bucket = process.env.S3_BUCKET_NAME;
    const url = new URL(fileUrl);
    let path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!bucket) return NextResponse.json({ message: "Storage is not configured" }, { status: 500 });

    // Path-style S3 URLs include the bucket in the URL path; virtual-hosted
    // URLs do not. Accept both, but never allow a key outside the caller's
    // own images/voices prefix.
    if (path === bucket) path = "";
    else if (path.startsWith(bucket + "/")) path = path.slice(bucket.length + 1);

    const parts = path.split("/");
    if (parts.length !== 3 || !["images", "voices"].includes(parts[0]) || parts[1] !== userId || !parts[2]) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    await s3().deleteObject({ Bucket: bucket, Key: path }).promise();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("delete file:", error);
    return NextResponse.json({ message: "Delete failed" }, { status: 500 });
  }
}