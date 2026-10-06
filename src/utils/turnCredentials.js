import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 3600;

const parseUrls = (value) =>
  String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

const assertTurnUrls = (urls) => {
  if (!urls.length) throw new Error("TURN_URL is not configured");
  if (urls.some((url) => !/^turns?:/i.test(url))) {
    throw new Error("TURN_URL must contain only turn: or turns: URLs");
  }
  return urls;
};

const getTtlSeconds = () => {
  const configured = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(configured)));
};

const createEphemeralCredential = (ttlSeconds) => {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  // Keep the application identity opaque on the wire; TURN only needs a stable
  // value for the lifetime of this credential.
  const opaqueId = crypto.randomBytes(18).toString("hex");
  const username = expiresAt + ":" + opaqueId;
  const credential = crypto
    .createHmac("sha1", process.env.TURN_SECRET)
    .update(username)
    .digest("base64");
  return { username, credential, expiresAt };
};

export const buildTurnIceServers = (userId) => {
  const urls = assertTurnUrls(parseUrls(process.env.TURN_URL));
  if (!userId || typeof userId !== "string") throw new Error("Invalid TURN user");

  const ttl = getTtlSeconds();
  if (process.env.TURN_SECRET) {
    const { username, credential, expiresAt } = createEphemeralCredential(ttl);
    return {
      iceServers: [{ urls, username, credential }],
      ttl,
      expiresAt,
      mode: "ephemeral",
    };
  }

  const username = String(process.env.TURN_USERNAME || "");
  const credential = String(process.env.TURN_CREDENTIAL || "");
  if (!username || !credential) {
    throw new Error("TURN_SECRET or TURN_USERNAME/TURN_CREDENTIAL must be configured");
  }

  return {
    iceServers: [{ urls, username, credential }],
    ttl: null,
    expiresAt: null,
    mode: "static",
  };
};

export const TURN_DEFAULT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
