import { type NextRequest } from "next/server";

import { requireApiSession } from "@/lib/auth/session";
import { failure, readJson, success } from "@/lib/http";
import { confirmMfaEnrollment } from "@/lib/mfa/totp";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { mfaCodeSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const input = await readJson(request, mfaCodeSchema);
    const limit = await consumeRateLimit({
      scope: "mfa-enrollment-confirmation",
      identifier: session.user.id,
      limit: 6,
      windowSeconds: 10 * 60,
    });
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many MFA confirmation attempts.", 429);
    }
    await confirmMfaEnrollment({
      userId: session.user.id,
      email: session.user.email,
      code: input.code,
    });
    await getDb().auditLog.create({
      data: {
        actorId: session.user.id,
        action: "MFA_ENABLED_OR_ROTATED",
        resource: "User",
        resourceId: session.user.id,
        outcome: "SUCCESS",
      },
    });
    return success({ enabled: true });
  } catch (error) {
    return failure(error);
  }
}
