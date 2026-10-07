import connectToDB from "@/db";
import { compare, hashSync } from "bcrypt";
import { cookies } from "next/headers";
import UserSchema from "@/schemas/userSchema";
import tokenGenerator from "@/utils/TokenGenerator";
import { getRequestIp, rateLimit } from "@/utils/rateLimit";
import SessionSchema from "@/schemas/sessionSchema";
import { verifyTotp } from "@/utils/totp";

// Valid hash used to equalise timing when the account does not exist.
const DUMMY_HASH = hashSync("dummy-password-for-timing", 12);

export const POST = async (req: Request) => {
  const ipLimit = await rateLimit("login:ip:" + getRequestIp(req), 10, 60_000);
  if (!ipLimit.allowed) return Response.json({ message: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } });

  try {
    await connectToDB();
    const body = await req.json();
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!phone || !password || phone.length > 30 || password.length > 128) return Response.json({ message: "Invalid credentials" }, { status: 400 });

    const accountLimit = await rateLimit("login:account:" + phone, 10, 60_000);
    if (!accountLimit.allowed) return Response.json({ message: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfter) } });

    const userData = await UserSchema.findOne({ phone }).select("+password +twoFactorSecret +twoFactorBackupCodes");
    // Always run bcrypt so response time doesn't reveal whether the phone exists.
    const passwordOk = await compare(password, userData?.password ?? DUMMY_HASH);
    if (!userData || !passwordOk) {
      return Response.json({ message: "Invalid phone or password" }, { status: 401 });
    }

    if (userData.twoFactorEnabled) {
      const totp = typeof body?.totp === "string" ? body.totp.trim() : "";
      const recovery = typeof body?.recoveryCode === "string" ? body.recoveryCode.trim().toUpperCase() : "";
      const twoFactorOk = (totp && verifyTotp(userData.twoFactorSecret || "", totp))
        || (recovery && Array.isArray(userData.twoFactorBackupCodes) && userData.twoFactorBackupCodes.includes(recovery));
      if (!twoFactorOk) return Response.json({ message: "Two-factor authentication required", requires2FA: true }, { status: 401 });
      if (recovery) {
        const consumed = await UserSchema.updateOne(
          { _id: userData._id, twoFactorBackupCodes: recovery },
          { $pull: { twoFactorBackupCodes: recovery } },
        );
        if (consumed.modifiedCount !== 1) {
          return Response.json({ message: "Invalid recovery code" }, { status: 401 });
        }
      }
    }
    const session = await SessionSchema.create({
      user: userData._id,
      device: typeof body?.device === "string" ? body.device.slice(0,120) : "Web browser",
      ip: getRequestIp(req),
      userAgent: req.headers.get("user-agent") || "unknown",
    });
    const token = tokenGenerator(userData._id.toString(), 7, userData.sessionVersion ?? 0, session._id.toString());
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
