import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function hashPassword(plainText: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plainText, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plainText: string, encoded: string): boolean {
  const [salt, storedHash] = encoded.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const incoming = scryptSync(plainText, salt, KEY_LEN);
  const original = Buffer.from(storedHash, "hex");
  if (incoming.length !== original.length) {
    return false;
  }

  return timingSafeEqual(incoming, original);
}