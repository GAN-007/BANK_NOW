import { type NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import {
  requireApiSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { hashOpaqueToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { failure, readJson, success } from "@/lib/http";
import { revokeSessionSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    const sessions = await getDb().session.findMany({
      where: {
        userId: session.user.id,
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
        tokenHash: true,
      },
    });
    const currentTokenHash = hashOpaqueToken(
      request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "",
    );
    return success(
      sessions.map((item) => ({
        id: item.id,
        userAgent: item.userAgent,
        createdAt: item.createdAt.toISOString(),
        lastUsedAt: item.lastUsedAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        current: item.tokenHash === currentTokenHash,
      })),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const input = await readJson(request, revokeSessionSchema);
    if (input.sessionId === session.id) {
      throw new AppError(
        "CURRENT_SESSION_REQUIRES_SIGN_OUT",
        "Use the sign-out action to end the current session.",
        422,
      );
    }
    const result = await getDb().session.updateMany({
      where: {
        id: input.sessionId,
        userId: session.user.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new AppError("SESSION_NOT_FOUND", "The selected session was not found.", 404);
    }
    return success({ revoked: true });
  } catch (error) {
    return failure(error);
  }
}
