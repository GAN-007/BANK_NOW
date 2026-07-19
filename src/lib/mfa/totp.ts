import { randomBytes } from "node:crypto";

import QRCode from "qrcode";
import { Secret, TOTP } from "otpauth";

import { encryptField, decryptField, hashOpaqueToken } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

function normalizeCode(code: string): string {
  return code.replace(/\s/g, "");
}

function createRecoveryCode(): string {
  const value = randomBytes(8).toString("hex").toUpperCase();
  return value.slice(0, 4) + "-" + value.slice(4, 8) + "-" + value.slice(8, 12);
}

function totpFor(secret: Secret, email: string): TOTP {
  return new TOTP({
    issuer: getEnv().APP_NAME,
    label: email,
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

function timestepForValidation(delta: number, now = Date.now()): bigint {
  return BigInt(Math.floor(now / 1000 / 30) + delta);
}

export async function startMfaEnrollment(user: {
  id: string;
  email: string;
}): Promise<{ qrCodeDataUrl: string; manualSecret: string; recoveryCodes: string[] }> {
  const secret = new Secret({ size: 20 });
  const totp = totpFor(secret, user.email);
  const recoveryCodes = Array.from({ length: 10 }, createRecoveryCode);

  await getDb().$transaction(async (tx) => {
    await tx.mfaFactor.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        encryptedSecret: encryptField(secret.base32),
      },
      update: {
        encryptedSecret: encryptField(secret.base32),
        confirmedAt: null,
        lastUsedAt: null,
        lastUsedTimestep: null,
      },
    });

    await tx.mfaRecoveryCode.deleteMany({
      where: { userId: user.id },
    });

    await tx.mfaRecoveryCode.createMany({
      data: recoveryCodes.map((code) => ({
        userId: user.id,
        codeHash: hashOpaqueToken(code),
      })),
    });
  });

  return {
    qrCodeDataUrl: await QRCode.toDataURL(totp.toString(), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    }),
    manualSecret: secret.base32,
    recoveryCodes,
  };
}

export async function confirmMfaEnrollment(input: {
  userId: string;
  email: string;
  code: string;
}): Promise<void> {
  const factor = await getDb().mfaFactor.findUnique({
    where: { userId: input.userId },
  });

  if (!factor) {
    throw new AppError("MFA_SETUP_NOT_FOUND", "Start MFA setup before confirming it.", 404);
  }

  const secret = Secret.fromBase32(decryptField(factor.encryptedSecret));
  const result = TOTP.validate({
    token: normalizeCode(input.code),
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    window: 1,
  });

  if (result === null) {
    throw new AppError("INVALID_MFA_CODE", "The authenticator code is invalid or expired.", 422);
  }

  await getDb().mfaFactor.update({
    where: { userId: input.userId },
    data: {
      confirmedAt: new Date(),
      lastUsedAt: new Date(),
      lastUsedTimestep: timestepForValidation(result),
    },
  });
}

export async function verifyMfaFactor(input: {
  userId: string;
  email: string;
  code: string;
}): Promise<{ usedRecoveryCode: boolean }> {
  const normalized = normalizeCode(input.code).toUpperCase();
  const factor = await getDb().mfaFactor.findUnique({
    where: { userId: input.userId },
  });

  if (!factor?.confirmedAt) {
    throw new AppError("MFA_NOT_ENABLED", "Multi-factor authentication is not enabled.", 422);
  }

  if (/^[0-9]{6}$/.test(normalized)) {
    const secret = Secret.fromBase32(decryptField(factor.encryptedSecret));
    const result = TOTP.validate({
      token: normalized,
      secret,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      window: 1,
    });

    if (result !== null) {
      const timestep = timestepForValidation(result);
      const consumed = await getDb().mfaFactor.updateMany({
        where: {
          userId: input.userId,
          confirmedAt: { not: null },
          OR: [
            { lastUsedTimestep: null },
            { lastUsedTimestep: { lt: timestep } },
          ],
        },
        data: {
          lastUsedAt: new Date(),
          lastUsedTimestep: timestep,
        },
      });
      if (consumed.count === 1) {
        return { usedRecoveryCode: false };
      }
      throw new AppError(
        "MFA_CODE_REPLAYED",
        "This authenticator code was already used. Wait for a new code.",
        409,
      );
    }
  }

  const recovery = await getDb().mfaRecoveryCode.findUnique({
    where: { codeHash: hashOpaqueToken(normalized) },
  });

  if (recovery?.userId === input.userId && !recovery.usedAt) {
    const consumed = await getDb().mfaRecoveryCode.updateMany({
      where: {
        id: recovery.id,
        userId: input.userId,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 1) {
      return { usedRecoveryCode: true };
    }
  }

  throw new AppError("INVALID_MFA_CODE", "The authenticator code is invalid or expired.", 422);
}
