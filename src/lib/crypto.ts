import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getEnv } from "@/lib/env";

const ENCRYPTION_VERSION = "v1";

function encryptionKey(): Buffer {
  return Buffer.from(getEnv().FIELD_ENCRYPTION_KEY, "base64");
}

export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHmac("sha256", getEnv().SESSION_PEPPER).update(token).digest("hex");
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secureEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(hashValue(left), "hex");
  const rightHash = Buffer.from(hashValue(right), "hex");
  return timingSafeEqual(leftHash, rightHash);
}

export function secureHashEqual(leftHash: string, rightHash: string): boolean {
  const left = Buffer.from(leftHash, "hex");
  const right = Buffer.from(rightHash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encryptField(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptField(serialized: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = serialized.split(".");
  if (
    version !== ENCRYPTION_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext
  ) {
    throw new Error("Unsupported encrypted field format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
