import { type NextRequest } from "next/server";

import { beginLogin } from "@/lib/auth/service";
import { setSessionCookies } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  failure,
  readJson,
  requestIp,
  requestUserAgent,
  success,
} from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, loginSchema);
    const rateLimit = await consumeRateLimit({
      scope: "login",
      identifier: requestIp(request) + ":" + input.email.toLowerCase(),
      limit: 8,
      windowSeconds: 15 * 60,
    });
    if (!rateLimit.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many sign-in attempts. Try again later.",
        429,
      );
    }

    const result = await beginLogin({
      ...input,
      ip: requestIp(request),
      userAgent: requestUserAgent(request),
    });

    if (result.mfaRequired) {
      return success({
        mfaRequired: true,
        challengeToken: result.challengeToken,
      });
    }

    const response = success({ mfaRequired: false });
    setSessionCookies(response, result.session);
    return response;
  } catch (error) {
    return failure(error);
  }
}
