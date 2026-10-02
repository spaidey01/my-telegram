import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { tokenDecoder } from "@/utils";
import { cookies } from "next/headers";

export const POST = async () => {
  try {
    await connectToDB();
    const cookieToken = (await cookies()).get("token")?.value;
    if (!cookieToken) return Response.json({ message: "You are not logged in" }, { status: 401 });

    const verifiedToken = tokenDecoder(cookieToken);
    if (!verifiedToken || typeof verifiedToken !== "object" || typeof verifiedToken.sub !== "string") {
      (await cookies()).delete("token");
      return Response.json({ message: "Invalid session" }, { status: 401 });
    }

    const userData = await UserSchema.findById(verifiedToken.sub).select("-password").lean();
    if (!userData) {
      (await cookies()).delete("token");
      return Response.json({ message: "Invalid session" }, { status: 401 });
    }
    return Response.json(userData, { status: 200 });
  } catch (err) {
    console.error("currentuser:", err);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
};