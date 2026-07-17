import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptField,
  encryptField,
  generateOpaqueToken,
  hashOpaqueToken,
  secureHashEqual,
} from "@/lib/crypto";
import { resetEnvironmentForTests } from "@/lib/env";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://banknow:banknow@localhost:5432/banknow");
  vi.stubEnv("SESSION_PEPPER", "test-only-session-pepper-with-at-least-thirty-two-characters");
  vi.stubEnv("FIELD_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  resetEnvironmentForTests();
});

describe("field encryption", () => {
  it("encrypts confidential values with random authenticated ciphertext", () => {
    const plaintext = "provider-token-that-must-not-be-stored-in-plain-text";
    const encryptedOne = encryptField(plaintext);
    const encryptedTwo = encryptField(plaintext);

    expect(encryptedOne).not.toEqual(plaintext);
    expect(encryptedOne).not.toEqual(encryptedTwo);
    expect(decryptField(encryptedOne)).toEqual(plaintext);
  });

  it("uses opaque token hashes for durable session references", () => {
    const token = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(token);

    expect(token).not.toEqual(tokenHash);
    expect(secureHashEqual(tokenHash, hashOpaqueToken(token))).toBe(true);
  });
});
