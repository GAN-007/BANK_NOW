import { type NextRequest } from "next/server";

import { completeMfaLogin } from "@/lib/auth/service";
import { setSessionCookies } from "@/lib/auth/session";
import {
  failure,
  readJson,
  requestIp,
  requestUserAgent,
  success,
} from "@/lib/http";
import { AppError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { mfaLoginSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, mfaLoginSchema);
    const rateLimit = await consumeRateLimit({
      scope: "mfa-login",
      identifier: requestIp(request) + ":" + input.challengeToken,
      limit: 6,
      windowSeconds: 5 * 60,
    });
    if (!rateLimit.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many verification attempts. Start sign-in again.",
        429,
      );
    }
    const session = await completeMfaLogin({
      ...input,
      ip: requestIp(request),
      userAgent: requestUserAgent(request),
    });
    const response = success({ mfaRequired: false });
    setSessionCookies(response, session);
    return response;
  } catch (error) {
    return failure(error);
  }
}
