import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import SessionSchema from "@/schemas/sessionSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";

export const POST = async () => {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;
    const decoded = token ? tokenDecoder(token) : false;

    if (decoded && typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.sv === "number" && typeof decoded.sid === "string") {
      await connectToDB();
      await SessionSchema.updateOne(
        { _id: decoded.sid, user: decoded.sub, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }

    cookieStore.delete("token");
    return Response.json("Done", { status: 200 });
  } catch (err) {
    console.error("logout:", err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
