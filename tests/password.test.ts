import { describe, expect, it } from "vitest";

import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "@/lib/auth/password";

describe("password policy", () => {
  it("requires a long mixed-character password", () => {
    expect(() => validatePasswordPolicy("weakpassword")).toThrow("upper-case");
    expect(() => validatePasswordPolicy("Short1!")).toThrow("between 12");
  });

  it("uses Argon2id hashes", async () => {
    const password = "GoodPassword!2026";
    const hashed = await hashPassword(password);

    expect(hashed.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hashed, password)).resolves.toBe(true);
    await expect(verifyPassword(hashed, "WrongPassword!2026")).resolves.toBe(false);
  });
});
