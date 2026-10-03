import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import { rateLimit, getRequestIp } from "@/utils/rateLimit";

export const POST = async (req: Request) => {
  const limit = await rateLimit("username-check:" + getRequestIp(req), 30, 60_000);
  if (!limit.allowed) {
    return Response.json(
      { isValid: false, message: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    await connectToDB();
    const body = await req.json();
    const query = typeof body?.query === "string" ? body.query : "";
    const trimmedQuery = query.replace(/^@/, "").trim().toLowerCase();

    if (trimmedQuery.length < 3 || trimmedQuery.length > 20 || !/^[a-zA-Z0-9_]{3,20}$/.test(trimmedQuery)) {
      return Response.json({ isValid: false, message: "Username format is invalid." }, { status: 403 });
    }

    const isUsernameExist = await UserSchema.findOne({ username: trimmedQuery }).select("_id").lean();

    return Response.json({
      isValid: !isUsernameExist,
      message: isUsernameExist ? "This username is already taken." : null,
    }, { status: isUsernameExist ? 403 : 200 });
  } catch (err) {
    console.error("username-check:", err);
    return Response.json({ message: "Unknown error, try later." }, { status: 500 });
  }
};
