import connectToDB from "@/db";
import { compare, hashSync } from "bcrypt";
import { cookies } from "next/headers";
import UserSchema from "@/schemas/userSchema";
import tokenGenerator from "@/utils/TokenGenerator";
import { getRequestIp, rateLimit } from "@/utils/rateLimit";
import SessionSchema from "@/schemas/sessionSchema";
import { hashBackupCode, verifyTotp } from "@/utils/totp";
import { isSafeBrowserRequest } from "@/utils/csrf";

const DUMMY_HASH = hashSync("dummy-password-for-timing", 12);

export const POST = async (req: Request) => {
  if (!isSafeBrowserRequest(req)) return Response.json({ message: "Forbidden" }, { status: 403 });
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
    const passwordOk = await compare(password, userData?.password ?? DUMMY_HASH);
    if (!userData || !passwordOk) return Response.json({ message: "Invalid phone or password" }, { status: 401 });

    if (userData.twoFactorEnabled) {
      const totp = typeof body?.totp === "string" ? body.totp.trim() : "";
      const recovery = typeof body?.recoveryCode === "string" ? body.recoveryCode.trim().toUpperCase() : "";
      const totpOk = Boolean(totp) && verifyTotp(userData.twoFactorSecret || "", totp);
      if (!totpOk) {
        const recoveryHash = recovery ? hashBackupCode(recovery) : "";
        let consumed = await UserSchema.updateOne(
          { _id: userData._id, twoFactorBackupCodes: recoveryHash },
          { $pull: { twoFactorBackupCodes: recoveryHash } },
        );
        if (consumed.modifiedCount !== 1 && recovery) {
          consumed = await UserSchema.updateOne(
            { _id: userData._id, twoFactorBackupCodes: recovery },
            [{
              $set: {
                twoFactorBackupCodes: {
                  $map: {
                    input: "$twoFactorBackupCodes",
                    as: "stored",
                    in: {
                      $cond: [
                        { $eq: ["$stored", recovery] },
                        recoveryHash,
                        "$stored",
                      ],
                    },
                  },
                },
              },
            }],
          );
        }
        if (consumed.modifiedCount !== 1) return Response.json({ message: "Two-factor authentication required", requires2FA: true }, { status: 401 });
      }
    }

    const sessionVersion = userData.sessionVersion ?? 0;
    const session = await SessionSchema.create({
      user: userData._id,
      sessionVersion,
      device: typeof body?.device === "string" ? body.device.slice(0,120) : "Web browser",
      ip: getRequestIp(req),
      userAgent: req.headers.get("user-agent") || "unknown",
    });
    const token = tokenGenerator(userData._id.toString(), 7, sessionVersion, session._id.toString());
    (await cookies()).set("token", token, {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    const safeUser = userData.toObject();
    delete safeUser.password;
    delete safeUser.twoFactorSecret;
    delete safeUser.twoFactorBackupCodes;
    return Response.json(safeUser, { status: 200 });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
