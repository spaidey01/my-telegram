import { Secret, verify } from "jsonwebtoken";

const tokenDecoder = (token: string) => {
  try {
    const secret = process.env.secretKey;
    if (!secret) return false;
    const decoded = verify(token, secret as Secret);
    if (typeof decoded === "object" && decoded?.scope === "socket") return false;
    return decoded;
  } catch {
    return false;
  }
};

export default tokenDecoder;
