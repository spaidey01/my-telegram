import connectToDB from "@/db";
import { compare } from "bcrypt";
import { cookies } from "next/headers";
import UserSchema from "@/schemas/userSchema";
import tokenGenerator from "@/utils/TokenGenerator";

export const POST = async (req: Request) => {
  try {
    await connectToDB();
    const body = await req.json();
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!phone || !password) return Response.json({ message: "Invalid credentials" }, { status: 400 });

    const userData = await UserSchema.findOne({ phone }).select("+password");
    if (!userData || !(await compare(password, userData.password))) {
      return Response.json({ message: "Invalid phone or password" }, { status: 401 });
    }

    const token = tokenGenerator(userData._id.toString(), 7);
    (await cookies()).set("token", token, {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    const safeUser = userData.toObject();
    delete safeUser.password;
    return Response.json(safeUser, { status: 200 });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
