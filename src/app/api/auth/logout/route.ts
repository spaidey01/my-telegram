import connectToDB from "@/db";
import mongoose from "mongoose";
import SessionSchema from "@/schemas/sessionSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import { isSafeBrowserRequest } from "@/utils/csrf";
import { acquireSessionMutationLock, releaseSessionMutationLock } from "@/utils/sessionMutationLock";

export const POST = async (req: Request) => {
  if (!isSafeBrowserRequest(req)) return Response.json({ message: "Forbidden" }, { status: 403 });
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;
    const decoded = token ? tokenDecoder(token) : false;
    if (decoded && typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.sv === "number" && typeof decoded.sid === "string" && mongoose.isValidObjectId(decoded.sub) && mongoose.isValidObjectId(decoded.sid)) {
      await connectToDB();
      const lock = await acquireSessionMutationLock(decoded.sub);
      if (!lock) return Response.json({ message: "Session mutation temporarily unavailable" }, { status: 503 });
      try {
        await SessionSchema.updateOne(
          { _id: decoded.sid, user: decoded.sub, sessionVersion: decoded.sv, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
      } finally {
        await releaseSessionMutationLock(lock);
      }
    }
    cookieStore.delete("token");
    return Response.json("Done", { status: 200 });
  } catch (err) {
    console.error("logout:", err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
