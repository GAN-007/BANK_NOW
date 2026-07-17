import { cookies } from "next/headers";
import { type NextRequest, type NextResponse } from "next/server";

import {
  type KycStatus,
  type UserRole,
  type UserStatus,
} from "@/generated/prisma/client";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashValue,
  secureHashEqual,
} from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "bank_now_session";
export const CSRF_COOKIE_NAME = "bank_now_csrf";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const LAST_USED_REFRESH_MS = 1000 * 60 * 5;

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  kycStatus: KycStatus;
  emailVerifiedAt: Date | null;
};

export type AuthenticatedSession = {
  id: string;
  csrfTokenHash: string;
  user: CurrentUser;
};

const currentUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  kycStatus: true,
  emailVerifiedAt: true,
} as const;

function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    expires,
  };
}

function csrfCookieOptions(expires: Date) {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export async function createSession(input: {
  userId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ sessionToken: string; csrfToken: string; expiresAt: Date }> {
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await getDb().session.create({
    data: {
      userId: input.userId,
      tokenHash: hashOpaqueToken(sessionToken),
      csrfTokenHash: hashOpaqueToken(csrfToken),
      ipHash: input.ip ? hashValue(input.ip) : undefined,
      userAgent: input.userAgent,
      expiresAt,
    },
  });

  return { sessionToken, csrfToken, expiresAt };
}

export function setSessionCookies(
  response: NextResponse,
  session: { sessionToken: string; csrfToken: string; expiresAt: Date },
): void {
  response.cookies.set(SESSION_COOKIE_NAME, session.sessionToken, sessionCookieOptions(session.expiresAt));
  response.cookies.set(CSRF_COOKIE_NAME, session.csrfToken, csrfCookieOptions(session.expiresAt));
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    ...csrfCookieOptions(new Date(0)),
    maxAge: 0,
  });
}

export async function getSessionByToken(
  sessionToken: string | undefined,
): Promise<AuthenticatedSession | null> {
  if (!sessionToken) {
    return null;
  }

  const session = await getDb().session.findUnique({
    where: { tokenHash: hashOpaqueToken(sessionToken) },
    select: {
      id: true,
      csrfTokenHash: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: currentUserSelect },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  if (Date.now() - session.lastUsedAt.getTime() >= LAST_USED_REFRESH_MS) {
    await getDb().session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
  }

  return {
    id: session.id,
    csrfTokenHash: session.csrfTokenHash,
    user: session.user,
  };
}

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  return getSessionByToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const session = await getCurrentSession();
  if (!session) {
    throw new AppError("UNAUTHENTICATED", "Sign in is required.", 401);
  }
  return session.user;
}

function verifyRequestOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(getEnv().NEXT_PUBLIC_APP_URL).origin;

  if (origin && origin !== expectedOrigin) {
    throw new AppError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  if (!origin && getEnv().NODE_ENV === "production") {
    const referer = request.headers.get("referer");
    if (!referer || !referer.startsWith(expectedOrigin + "/")) {
      throw new AppError("INVALID_ORIGIN", "A same-origin request is required.", 403);
    }
  }
}

export async function requireApiSession(
  request: NextRequest,
  options: { csrf?: boolean } = {},
): Promise<AuthenticatedSession> {
  const session = await getSessionByToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    throw new AppError("UNAUTHENTICATED", "Sign in is required.", 401);
  }

  if (options.csrf) {
    verifyRequestOrigin(request);
    const submitted = request.headers.get("x-csrf-token");
    const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
    if (!submitted || !cookieToken || submitted !== cookieToken) {
      throw new AppError("CSRF_VALIDATION_FAILED", "Security validation failed. Refresh and retry.", 403);
    }

    if (!secureHashEqual(hashOpaqueToken(submitted), session.csrfTokenHash)) {
      throw new AppError("CSRF_VALIDATION_FAILED", "Security validation failed. Refresh and retry.", 403);
    }
  }

  return session;
}

export async function revokeSessionByToken(sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) {
    return;
  }

  await getDb().session.updateMany({
    where: {
      tokenHash: hashOpaqueToken(sessionToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function listActiveSessions(userId: string, currentSessionId: string) {
  const sessions = await getDb().session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastUsedAt: "desc" },
    select: {
      id: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    current: session.id === currentSessionId,
  }));
}

export function requireRole(user: CurrentUser, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role)) {
    throw new AppError("FORBIDDEN", "You do not have permission for this action.", 403);
  }
}

export function assertUserCanTransact(user: CurrentUser): void {
  if (user.status !== "ACTIVE") {
    throw new AppError("ACCOUNT_RESTRICTED", "Your account is not active for money movement.", 403);
  }
  if (!user.emailVerifiedAt) {
    throw new AppError("EMAIL_NOT_VERIFIED", "Verify your e-mail before moving funds.", 403);
  }
  if (user.kycStatus !== "VERIFIED") {
    throw new AppError("KYC_REQUIRED", "Identity verification must be completed before moving funds.", 403);
  }
}
