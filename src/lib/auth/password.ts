import { hash, verify } from "@node-rs/argon2";

import { AppError } from "@/lib/errors";

const passwordOptions = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function validatePasswordPolicy(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AppError(
      "WEAK_PASSWORD",
      "Use a password between 12 and 128 characters.",
      422,
    );
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSymbol) {
    throw new AppError(
      "WEAK_PASSWORD",
      "Use upper-case, lower-case, number, and symbol characters.",
      422,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordPolicy(password);
  return hash(password, passwordOptions);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password, passwordOptions);
}
