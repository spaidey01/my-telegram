import { Secret, sign } from "jsonwebtoken";

const getSecret = () => {
  const secret = process.env.secretKey;
  if (!secret) throw new Error("secretKey is not configured");
  return secret as Secret;
};

const tokenGenerator = (userId: string, days: number = 7, sessionVersion = 0) =>
  sign({ sub: userId, sv: sessionVersion }, getSecret(), { expiresIn: 60 * 60 * 24 * days });

export const socketTokenGenerator = (userId: string, sessionVersion = 0) =>
  sign({ sub: userId, sv: sessionVersion, scope: "socket" }, getSecret(), { expiresIn: "5m" });

export default tokenGenerator;
