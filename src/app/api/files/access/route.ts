import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { cookies } from "next/headers";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import RoomSchema from "@/schemas/roomSchema";
import MessageSchema from "@/schemas/messageSchema";
import tokenDecoder from "@/utils/TokenDecoder";

const s3 = () => new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

const validKey = (key: string) =>
  /^(images|voices)\/[a-fA-F0-9]{24}\/[0-9a-f-]{36}$/.test(key);

export async function GET(req: Request) {
  try {
    const token = (await cookies()).get("token")?.value;
    const decoded = token ? tokenDecoder(token) : false;
    const userId = decoded && typeof decoded === "object" && typeof decoded.sub === "string" ? String(decoded.sub) : null;
    const sessionVersion = decoded && typeof decoded === "object" && typeof decoded.sv === "number" ? decoded.sv : null;
    if (!userId || sessionVersion === null) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    await connectToDB();
    const activeUser = await UserSchema.findOne({ _id: userId, sessionVersion }).select("_id").lean();
    if (!activeUser) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const key = url.searchParams.get("key") || "";
    if (!validKey(key)) return NextResponse.json({ message: "Invalid file" }, { status: 400 });

    const bucket = process.env.S3_BUCKET_NAME;
    if (!bucket || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !process.env.S3_ENDPOINT) {
      return NextResponse.json({ message: "Storage is not configured" }, { status: 500 });
    }

    const accessUrl = `/api/files/access?key=${encodeURIComponent(key)}`;
    const ownsFile = key.split("/")[1] === userId;
    let canAccess = ownsFile;

    if (!canAccess) {
      const messageRef = await MessageSchema.findOne({ "voiceData.src": accessUrl }).select("roomID").lean();
      const roomRef = await RoomSchema.findOne({ avatar: accessUrl, participants: userId }).select("_id").lean();
      if (messageRef && !Array.isArray(messageRef)) {
        canAccess = Boolean(await RoomSchema.exists({ _id: messageRef.roomID, participants: userId }));
      }
      if (roomRef && !Array.isArray(roomRef)) canAccess = true;
    }

    if (!canAccess) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

    const signedUrl = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 5 * 60,
    });
    return NextResponse.redirect(signedUrl, 302);
  } catch (error) {
    console.error("file access:", error);
    return NextResponse.json({ message: "Unable to access file" }, { status: 404 });
  }
}
