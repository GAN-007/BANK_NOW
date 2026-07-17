import { createCustomerWallet } from "@/lib/accounts";
import { hashOpaqueToken, hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email/service";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { verifyMfaFactor } from "@/lib/mfa/totp";
import {
  createSession,
  type CurrentUser,
} from "@/lib/auth/session";
import {
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { generateOpaqueToken } from "@/lib/crypto";
import { AuditOutcome } from "@/generated/prisma/client";

const EMAIL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const PASSWORD_RESET_TOKEN_TTL_MS = 1000 * 60 * 30;
const MFA_CHALLENGE_TTL_MS = 1000 * 60 * 5;
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 1000 * 60 * 15;

type LoginSession = {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
};

type LoginResult =
  | {
      mfaRequired: false;
      session: LoginSession;
    }
  | {
      mfaRequired: true;
      challengeToken: string;
    };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function verificationHtml(input: {
  firstName: string;
  verificationUrl: string;
}): string {
  return (
    "<main style=\"font-family:Arial,sans-serif;max-width:560px;margin:auto\">" +
    "<h1>Verify your BANK NOW e-mail</h1>" +
    "<p>Hello " +
    escapeHtml(input.firstName) +
    ",</p><p>Confirm this e-mail address before using money-movement features.</p>" +
    "<p><a href=\"" +
    input.verificationUrl +
    "\" style=\"display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none\">Verify e-mail</a></p>" +
    "<p>This link expires in 24 hours. If you did not create this account, ignore this message.</p></main>"
  );
}

function passwordResetHtml(input: {
  firstName: string;
  resetUrl: string;
}): string {
  return (
    "<main style=\"font-family:Arial,sans-serif;max-width:560px;margin:auto\">" +
    "<h1>Reset your BANK NOW password</h1>" +
    "<p>Hello " +
    escapeHtml(input.firstName) +
    ",</p><p>Use the link below to choose a new password. This link expires in 30 minutes.</p>" +
    "<p><a href=\"" +
    input.resetUrl +
    "\" style=\"display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none\">Reset password</a></p>" +
    "<p>If you did not request this, you can safely ignore this e-mail.</p></main>"
  );
}

async function issueEmailVerification(input: {
  id: string;
  email: string;
  firstName: string;
}): Promise<{ developmentVerificationUrl?: string }> {
  const environment = getEnv();
  if (environment.NODE_ENV === "production" && !environment.RESEND_API_KEY) {
    throw new AppError(
      "EMAIL_DELIVERY_UNAVAILABLE",
      "E-mail delivery is temporarily unavailable. Try again shortly.",
      503,
    );
  }

  const rawToken = generateOpaqueToken();
  const verificationUrl = new URL("/verify-email", environment.NEXT_PUBLIC_APP_URL);
  verificationUrl.searchParams.set("token", rawToken);

  await getDb().$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({
      where: {
        userId: input.id,
        consumedAt: null,
      },
    });
    await tx.emailVerificationToken.create({
      data: {
        userId: input.id,
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    });
  });

  await sendTransactionalEmail({
    to: input.email,
    subject: "Verify your BANK NOW e-mail",
    html: verificationHtml({
      firstName: input.firstName,
      verificationUrl: verificationUrl.toString(),
    }),
  });

  return environment.NODE_ENV === "production"
    ? {}
    : { developmentVerificationUrl: verificationUrl.toString() };
}

export async function registerUser(input: {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  password: string;
}): Promise<{ userId: string; developmentVerificationUrl?: string }> {
  const email = normalizeEmail(input.email);
  const existing = await getDb().user.findUnique({
    where: { email },
    select: {
      id: true,
      emailVerifiedAt: true,
      firstName: true,
      email: true,
    },
  });

  if (existing?.emailVerifiedAt) {
    throw new AppError("EMAIL_ALREADY_REGISTERED", "An account already exists for this e-mail address.", 409);
  }

  if (existing) {
    const verification = await issueEmailVerification(existing);
    return {
      userId: existing.id,
      developmentVerificationUrl: verification.developmentVerificationUrl,
    };
  }

  const passwordHash = await hashPassword(input.password);
  const user = await getDb().$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email,
        phoneNumber: input.phoneNumber?.trim() || undefined,
        passwordHash,
      },
    });

    await tx.kycProfile.create({
      data: {
        userId: created.id,
      },
    });
    await createCustomerWallet(tx, created);
    return created;
  });

  const verification = await issueEmailVerification(user);
  return {
    userId: user.id,
    developmentVerificationUrl: verification.developmentVerificationUrl,
  };
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();

  await getDb().$transaction(async (tx) => {
    const verification = await tx.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    if (!verification || verification.consumedAt || verification.expiresAt <= now) {
      throw new AppError("INVALID_VERIFICATION_TOKEN", "This verification link is invalid or has expired.", 422);
    }

    const consumed = await tx.emailVerificationToken.updateMany({
      where: {
        id: verification.id,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new AppError("INVALID_VERIFICATION_TOKEN", "This verification link has already been used.", 409);
    }

    await tx.user.update({
      where: { id: verification.userId },
      data: {
        emailVerifiedAt: now,
        status: "ACTIVE",
      },
    });
  });
}

/**
 * Always resolves without revealing whether an address has an account. In
 * development, the URL is returned only to make local verification practical.
 */
export async function requestPasswordReset(input: {
  email: string;
}): Promise<{ developmentResetUrl?: string }> {
  const user = await getDb().user.findUnique({
    where: { email: normalizeEmail(input.email) },
    select: {
      id: true,
      email: true,
      firstName: true,
      emailVerifiedAt: true,
      status: true,
    },
  });
  if (!user || !user.emailVerifiedAt || user.status === "SUSPENDED") {
    return {};
  }

  const environment = getEnv();
  if (environment.NODE_ENV === "production" && !environment.RESEND_API_KEY) {
    throw new AppError(
      "EMAIL_DELIVERY_UNAVAILABLE",
      "E-mail delivery is temporarily unavailable. Try again shortly.",
      503,
    );
  }

  const rawToken = generateOpaqueToken();
  const resetUrl = new URL("/reset-password", environment.NEXT_PUBLIC_APP_URL);
  resetUrl.searchParams.set("token", rawToken);
  await getDb().$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { userId: user.id, consumedAt: null },
    });
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });
  });

  await sendTransactionalEmail({
    to: user.email,
    subject: "Reset your BANK NOW password",
    html: passwordResetHtml({ firstName: user.firstName, resetUrl: resetUrl.toString() }),
  });

  return environment.NODE_ENV === "production"
    ? {}
    : { developmentResetUrl: resetUrl.toString() };
}

export async function resetPassword(input: {
  token: string;
  password: string;
  ip?: string;
}): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const now = new Date();
  const reset = await getDb().passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      consumedAt: true,
      user: { select: { status: true } },
    },
  });
  if (!reset || reset.consumedAt || reset.expiresAt <= now) {
    throw new AppError("INVALID_RESET_TOKEN", "This password-reset link is invalid or has expired.", 422);
  }

  const passwordHash = await hashPassword(input.password);
  await getDb().$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: reset.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new AppError("INVALID_RESET_TOKEN", "This password-reset link has already been used.", 409);
    }

    await tx.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        status: reset.user.status === "LOCKED" ? "ACTIVE" : reset.user.status,
      },
    });
    await tx.session.updateMany({
      where: { userId: reset.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.mfaChallenge.updateMany({
      where: { userId: reset.userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorId: reset.userId,
        action: "PASSWORD_RESET",
        resource: "user",
        resourceId: reset.userId,
        outcome: AuditOutcome.SUCCESS,
        ipHash: input.ip ? hashValue(input.ip) : undefined,
      },
    });
  });
}

async function recordFailedLogin(user: {
  id: string;
  failedLoginCount: number;
}): Promise<void> {
  const nextFailureCount = user.failedLoginCount + 1;
  const shouldLock = nextFailureCount >= MAX_FAILED_LOGINS;
  await getDb().user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: shouldLock ? 0 : nextFailureCount,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : undefined,
      status: shouldLock ? "LOCKED" : undefined,
    },
  });
}

export async function beginLogin(input: {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const user = await getDb().user.findUnique({
    where: { email },
    include: {
      mfaFactor: true,
    },
  });

  if (!user) {
    await verifyPassword(
      "$argon2id$v=19$m=19456,t=2,p=1$AdISMzBh/vEtEONI2Bb2Bg$XD9uHxfSNUHg7HjKz6s/08aiL7VtgCrqLh6ErFuGi0o",
      input.password,
    );
    throw new AppError("INVALID_CREDENTIALS", "Invalid e-mail address or password.", 401);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("ACCOUNT_LOCKED", "Too many failed sign-in attempts. Try again later.", 423);
  }

  const passwordValid = await verifyPassword(user.passwordHash, input.password);
  if (!passwordValid) {
    await recordFailedLogin(user);
    throw new AppError("INVALID_CREDENTIALS", "Invalid e-mail address or password.", 401);
  }

  if (!user.emailVerifiedAt) {
    throw new AppError(
      "EMAIL_NOT_VERIFIED",
      "Verify your e-mail address before signing in.",
      403,
    );
  }

  if (user.status === "SUSPENDED") {
    throw new AppError("ACCOUNT_SUSPENDED", "This account has been suspended. Contact support.", 403);
  }

  await getDb().user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      status: user.status === "LOCKED" ? "ACTIVE" : user.status,
      lastLoginAt: new Date(),
    },
  });

  if (user.mfaFactor?.confirmedAt) {
    const challengeToken = generateOpaqueToken();
    await getDb().mfaChallenge.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(challengeToken),
        expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_MS),
      },
    });
    return { mfaRequired: true, challengeToken };
  }

  return {
    mfaRequired: false,
    session: await createSession({
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    }),
  };
}

export async function completeMfaLogin(input: {
  challengeToken: string;
  code: string;
  ip?: string;
  userAgent?: string;
}): Promise<LoginSession> {
  const challenge = await getDb().mfaChallenge.findUnique({
    where: {
      tokenHash: hashOpaqueToken(input.challengeToken),
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          emailVerifiedAt: true,
        },
      },
    },
  });

  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
    throw new AppError("INVALID_MFA_CHALLENGE", "This sign-in challenge is invalid or has expired.", 401);
  }

  if (challenge.user.status !== "ACTIVE" || !challenge.user.emailVerifiedAt) {
    throw new AppError("ACCOUNT_RESTRICTED", "This account is not eligible to sign in.", 403);
  }

  await verifyMfaFactor({
    userId: challenge.user.id,
    email: challenge.user.email,
    code: input.code,
  });

  const consumed = await getDb().mfaChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
    },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw new AppError("INVALID_MFA_CHALLENGE", "This sign-in challenge has already been used.", 409);
  }

  return createSession({
    userId: challenge.user.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

export function serializeCurrentUser(user: CurrentUser) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    kycStatus: user.kycStatus,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}
