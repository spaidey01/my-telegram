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

  // If a browser supplies Fetch Metadata but omits Origin/Referer, only
  // same-origin requests (or user-initiated navigations marked "none") are
  // accepted. Do not treat same-site sibling origins as trusted implicitly.
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  // Non-browser clients may omit Fetch Metadata and Origin/Referer entirely.
  // Authentication/session checks remain mandatory for these requests.
  return true;
};
