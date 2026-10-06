import { Secret, sign } from "jsonwebtoken";

const getSecret = () => {
  const secret = process.env.secretKey;
  if (!secret) throw new Error("secretKey is not configured");
  if (secret.length < 32) throw new Error("secretKey must be at least 32 characters");
  return secret as Secret;
};

const tokenGenerator = (userId: string, days: number = 7, sessionVersion = 0, sessionId?: string) =>
  sign({ sub: userId, sv: sessionVersion, ...(sessionId ? { sid: sessionId } : {}) }, getSecret(), { expiresIn: 60 * 60 * 24 * days, algorithm: "HS256" });

export const socketTokenGenerator = (userId: string, sessionVersion = 0, sessionId?: string) =>
  sign({ sub: userId, sv: sessionVersion, ...(sessionId ? { sid: sessionId } : {}), scope: "socket" }, getSecret(), { expiresIn: "5m", algorithm: "HS256" });

export default tokenGenerator;
