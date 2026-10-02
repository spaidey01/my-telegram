import { Secret, sign } from "jsonwebtoken";

const getSecret = () => {
  const secret = process.env.secretKey;
  if (!secret) throw new Error("secretKey is not configured");
  return secret as Secret;
};

const tokenGenerator = (userId: string, days: number = 7) =>
  sign({ sub: userId }, getSecret(), { expiresIn: 60 * 60 * 24 * days });

export const socketTokenGenerator = (userId: string) =>
  sign({ sub: userId, scope: "socket" }, getSecret(), { expiresIn: "5m" });

export default tokenGenerator;
