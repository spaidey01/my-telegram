const required = (env, key) => {
  const value = typeof env[key] === "string" ? env[key].trim() : "";
  if (!value) throw new Error(`${key} is required in production`);
  return value;
};

const requireHttpsUrl = (env, key) => {
  const value = required(env, key);
  const urls = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (urls.some((url) => !/^https:\/\//i.test(url))) {
    throw new Error(`${key} must use https:// in production`);
  }
  return value;
};

export const validateProductionEnv = (env = process.env) => {
  if (env.NODE_ENV !== "production") return { ok: true };

  required(env, "secretKey");
  if (env.secretKey.trim().length < 32) throw new Error("secretKey must be at least 32 characters");

  required(env, "MONGODB_URI");
  required(env, "REDIS_URL");
  required(env, "S3_ACCESS_KEY");
  required(env, "S3_SECRET_KEY");
  const endpoint = required(env, "S3_ENDPOINT");
  if (!/^https:\/\//i.test(endpoint)) throw new Error("S3_ENDPOINT must use https:// in production");
  required(env, "S3_BUCKET_NAME");

  requireHttpsUrl(env, "CLIENT_ORIGIN");
  requireHttpsUrl(env, "NEXT_PUBLIC_APP_URL");
  requireHttpsUrl(env, "NEXT_PUBLIC_SOCKET_SERVER_URL");

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
