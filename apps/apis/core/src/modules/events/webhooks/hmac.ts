import crypto from "node:crypto";

export function hmacSha256(secret: string, body: Uint8Array) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function signaturesMatch(actual: string | undefined, expected: string) {
  if (!actual) return false;

  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  if (actualBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}
