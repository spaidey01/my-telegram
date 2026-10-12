const required = (env, key) => {
  const value = typeof env[key] === "string" ? env[key].trim() : "";
  if (!value) throw new Error(`${key} is required in production`);
  return value;
};

const isLoopbackHost = (hostname) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]";

const requirePublicUrl = (env, key) => {
  const value = required(env, key);
  const urls = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (urls.length === 0) throw new Error(`${key} must contain at least one URL`);

  for (const rawUrl of urls) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`${key} contains an invalid URL`);
    }
    if (parsed.protocol === "https:") continue;
    if (parsed.protocol === "http:" && env.STARGRAM_ALLOW_HTTP === "true") continue;
    throw new Error(`${key} must use https:// in production unless STARGRAM_ALLOW_HTTP=true is explicitly set`);
  }
  return value;
};

const requireS3Endpoint = (env) => {
  const value = required(env, "S3_ENDPOINT");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("S3_ENDPOINT must be a valid URL");
  }
  if (parsed.protocol === "https:") return value;
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) return value;
  throw new Error("S3_ENDPOINT must use https://, or http:// on loopback only");
};

export const validateProductionEnv = (env = process.env) => {
  if (env.NODE_ENV !== "production") return { ok: true };

  required(env, "secretKey");
  if (env.secretKey.trim().length < 32) throw new Error("secretKey must be at least 32 characters");

  required(env, "MONGODB_URI");
  required(env, "REDIS_URL");
  required(env, "S3_ACCESS_KEY");
  required(env, "S3_SECRET_KEY");
  requireS3Endpoint(env);
  required(env, "S3_BUCKET_NAME");

  requirePublicUrl(env, "CLIENT_ORIGIN");
  requirePublicUrl(env, "NEXT_PUBLIC_APP_URL");
  requirePublicUrl(env, "NEXT_PUBLIC_SOCKET_SERVER_URL");

  required(env, "TURN_URL");
  required(env, "TURN_SECRET");
  if (String(env.TURN_SECRET).trim().length < 32) throw new Error("TURN_SECRET must be at least 32 characters");
  const ttl = Number(env.TURN_CREDENTIAL_TTL_SECONDS || 600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) {
    throw new Error("TURN_CREDENTIAL_TTL_SECONDS must be an integer between 60 and 3600");
  }

  required(env, "CLAMAV_HOST");
  const clamavPort = Number(env.CLAMAV_PORT || 3310);
  if (!Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535) {
    throw new Error("CLAMAV_PORT must be a valid TCP port");
  }

  const proxyCount = Number(env.TRUSTED_PROXY_COUNT ?? 0);
  if (!Number.isInteger(proxyCount) || proxyCount < 0) {
    throw new Error("TRUSTED_PROXY_COUNT must be a non-negative integer");
  }

  return { ok: true };
};
