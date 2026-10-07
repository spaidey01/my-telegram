const getAllowedOrigins = () =>
  (process.env.CLIENT_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export const isSafeBrowserRequest = (req) => {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = req.headers.get("origin");
  if (origin) return getAllowedOrigins().includes(origin);

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return getAllowedOrigins().includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  // Non-browser clients may not send Fetch Metadata or Origin/Referer.
  // Authentication/session checks remain mandatory for these requests.
  return true;
};
