import { type NextRequest } from "next/server";

import { registerUser } from "@/lib/auth/service";
import { AppError } from "@/lib/errors";
import { failure, readJson, requestIp, success } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { registerSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, registerSchema);
    const rateLimit = await consumeRateLimit({
      scope: "registration",
      identifier: requestIp(request),
      limit: 5,
      windowSeconds: 60 * 60,
    });
    if (!rateLimit.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many registration attempts. Try again later.",
        429,
      );
    }

    const registered = await registerUser(input);
    return success(registered, 201);
  } catch (error) {
    return failure(error);
  }
}
