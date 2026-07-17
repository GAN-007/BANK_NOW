import { type NextRequest } from "next/server";

import { requestPasswordReset } from "@/lib/auth/service";
import { AppError } from "@/lib/errors";
import { failure, readJson, requestIp, success } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestPasswordResetSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, requestPasswordResetSchema);
    const rateLimit = await consumeRateLimit({
      scope: "password-reset-request",
      identifier: requestIp(request) + ":" + input.email.toLowerCase(),
      limit: 5,
      windowSeconds: 60 * 60,
    });
    if (!rateLimit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many password-reset requests. Try again later.", 429);
    }

    const result = await requestPasswordReset(input);
    return success({
      message: "If that verified account exists, a password-reset link has been sent.",
      ...result,
    });
  } catch (error) {
    return failure(error);
  }
}
