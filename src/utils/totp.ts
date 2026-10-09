import crypto from "crypto";

const base32Decode = (input: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/,"").replace(/\\s+/g,"").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Invalid base32");
    bits += value.toString(2).padStart(5,"0");
  }
  const bytes = [];
  for (let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  return Buffer.from(bytes);
};

export const generateTotpSecret = () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  const bytes = crypto.randomBytes(20);
  for (const b of bytes) out += alphabet[b & 31];
  return out;
};

export const verifyTotp = (secret: string, token: string, window = 1) => {
  if (!/^\d{6}$/.test(token)) return false;
  const key = base32Decode(secret);
  const now = Math.floor(Date.now()/1000/30);
  for (let offset=-window; offset<=window; offset++) {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(now+offset));
    const digest = crypto.createHmac("sha1", key).update(buf).digest();
    const pos = digest[digest.length-1] & 15;
    const code = ((digest[pos]&127)<<24)|((digest[pos+1]&255)<<16)|((digest[pos+2]&255)<<8)|(digest[pos+3]&255);
    if (String(code % 1000000).padStart(6,"0") === token) return true;
  }
  return false;
};

export const generateBackupCodes = (count=10) =>
  Array.from({length:count}, () => crypto.randomBytes(5).toString("hex").toUpperCase());


export const hashBackupCode = (code: string) => crypto.createHash("sha256").update(code, "utf8").digest("hex");
