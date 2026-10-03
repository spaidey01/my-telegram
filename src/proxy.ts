import { NextRequest, NextResponse } from "next/server";

const isStateChanging = (method: string) =>
  method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

const allowedOrigins = () =>
  (process.env.CLIENT_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/") || !isStateChanging(req.method)) {
    return NextResponse.next();
  }

  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ message: "Origin not allowed" }, { status: 403 });
  }

  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next();

  const requestOrigin = req.nextUrl.origin.replace(/\/$/, "");
  const allowed = new Set([requestOrigin, ...allowedOrigins()]);
  if (!allowed.has(origin.replace(/\/$/, ""))) {
    return NextResponse.json({ message: "Origin not allowed" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
