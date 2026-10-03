import { createClient, type RedisClientType } from "redis";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;
let redisPromise: Promise<RedisClientType> | null = null;

const getRedis = async () => {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (error) => console.error("Redis rate-limit error:", error));
    redisPromise = client.connect().then(() => client as RedisClientType);
  }
  return redisPromise;
};

const cleanup = () => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

const memoryRateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) cleanup();
    if (buckets.size >= MAX_BUCKETS) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
};

const script = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

export const rateLimit = async (
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfter: number }> => {
  const redis = await getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
    }
    return memoryRateLimit(key, limit, windowMs);
  }

  try {
    const result = await redis.eval(script, {
      keys: [`rate-limit:${key}`],
      arguments: [String(limit), String(windowMs)],
    }) as [number, number];
    const count = Number(result[0]);
    const ttl = Math.max(1, Number(result[1]));
    return {
      allowed: count <= limit,
      retryAfter: count <= limit ? 0 : Math.ceil(ttl / 1000),
    };
  } catch (error) {
    console.error("Redis rate-limit failure:", error);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
  }
};

setInterval(cleanup, 60_000).unref();

export const getRequestIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
};
