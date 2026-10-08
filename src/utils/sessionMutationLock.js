import { createClient } from "redis";
import { randomUUID } from "node:crypto";

const redisUrl = process.env.REDIS_URL;
const LOCK_PREFIX = "stargram:session-mutation-lock:";
const LOCK_TTL_MS = 30_000;
let clientPromise;

const getClient = async () => {
  if (!redisUrl) throw new Error("REDIS_URL is required for session mutation locking");
  if (!clientPromise) {
    const client = createClient({ url: redisUrl });
    client.on("error", (error) => console.error("Session mutation lock Redis error:", error));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const acquireSessionMutationLock = async (userID, waitMs = 5_000) => {
  const client = await getClient();
  const key = LOCK_PREFIX + userID;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;

  do {
    const acquired = await client.set(key, token, { NX: true, PX: LOCK_TTL_MS });
    if (acquired === "OK") return { key, token };
    await sleep(25);
  } while (Date.now() < deadline);

  return null;
};

export const releaseSessionMutationLock = async (lock) => {
  if (!lock) return;
  const client = await getClient();
  await client.eval(
    'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
    { keys: [lock.key], arguments: [lock.token] },
  );
};

export const SESSION_MUTATION_LOCK_TTL_MS = LOCK_TTL_MS;