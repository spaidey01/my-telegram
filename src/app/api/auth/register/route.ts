import connectToDB from "@/db";
import RoomSchema from "@/schemas/roomSchema";
import UserSchema from "@/schemas/userSchema";
import { cookies } from "next/headers";
import { hash } from "bcrypt";
import tokenGenerator from "@/utils/TokenGenerator";

export const POST = async (req: Request) => {
  try {
    await connectToDB();
    const body = await req.json();
    const usernameRaw = typeof body?.username === "string" ? body.username.trim().replace(/^@/, "") : "";
    const phone = typeof body?.phone === "string" || typeof body?.phone === "number" ? String(body.phone).trim() : "";
    const purePass = typeof body?.password === "string" ? body.password : "";
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(usernameRaw) || !phone || purePass.length < 8 || purePass.length > 128) {
      return Response.json({ message: "Invalid registration data" }, { status: 400 });
    }

    const password = await hash(purePass, 12);
    const userData = await UserSchema.create({ name: usernameRaw, lastName: "", username: usernameRaw.toLowerCase(), password, phone });
    await RoomSchema.create({ name: "Saved Messages", avatar: "", type: "private", creator: userData._id, participants: [userData._id], admins: [userData._id] });

    const token = tokenGenerator(userData._id.toString(), 7);
    (await cookies()).set("token", token, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    const safeUser = userData.toObject();
    delete safeUser.password;
    return Response.json(safeUser, { status: 201 });
  } catch (error: any) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return Response.json({ message: `Already there is an account using this ${field === "phone" ? "phone" : "username"}` }, { status: 409 });
    }
    console.error(error);
    return Response.json({ message: "Unknown error, try later" }, { status: 500 });
  }
};
