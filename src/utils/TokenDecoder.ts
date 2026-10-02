import { Secret, verify } from "jsonwebtoken";

const tokenDecoder = (token: string) => {
  try {
    const secret = process.env.secretKey;
    if (!secret) return false;
    return verify(token, secret as Secret);
  } catch {
    return false;
  }
};

export default tokenDecoder;
