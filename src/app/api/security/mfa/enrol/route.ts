import { type NextRequest } from "next/server";

import { requireApiSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, readJson, success } from "@/lib/http";
import { startMfaEnrollment } from "@/lib/mfa/totp";
import { consumeRateLimit } from "@/lib/rate-limit";
import { passwordReauthenticationSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const input = await readJson(request, passwordReauthenticationSchema);
    const limit = await consumeRateLimit({
      scope: "mfa-enrollment",
      identifier: session.user.id,
      limit: 5,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many MFA setup attempts. Try again later.", 429);
    }
    const user = await getDb().user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new AppError("REAUTHENTICATION_FAILED", "The current password is incorrect.", 401);
    }
    const result = await startMfaEnrollment(session.user);
    return success(result, 201);
  } catch (error) {
    return failure(error);
  }
}
