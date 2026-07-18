import type { NextRequest } from "next/server";

import { getOwnedActiveAccount, resolveDestinationAccount } from "@/lib/accounts";
import { assertUserCanTransact, requireApiSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { failure, requestIp, success } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recipientLookupSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    assertUserCanTransact(session.user);
    const parsed = recipientLookupSchema.safeParse({
      sourceAccountId: request.nextUrl.searchParams.get("sourceAccountId"),
      accountNumber: request.nextUrl.searchParams.get("accountNumber"),
    });
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Enter a valid recipient account number.",
        422,
      );
    }

    const limit = await consumeRateLimit({
      scope: "recipient-lookup",
      identifier: session.user.id + ":" + requestIp(request),
      limit: 20,
      windowSeconds: 10 * 60,
    });
    if (!limit.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many recipient lookups. Try again later.",
        429,
      );
    }

    const [source, destination] = await Promise.all([
      getOwnedActiveAccount({
        userId: session.user.id,
        accountId: parsed.data.sourceAccountId,
      }),
      resolveDestinationAccount(parsed.data.accountNumber),
    ]);
    if (source.id === destination.id) {
      throw new AppError("INVALID_DESTINATION", "Choose a different recipient account.", 422);
    }
    if (source.currency !== destination.currency) {
      throw new AppError(
        "CURRENCY_MISMATCH",
        "The recipient account uses a different currency.",
        422,
      );
    }

    const response = success({
      accountNumber: destination.accountNumber,
      displayName: destination.displayName,
      currency: destination.currency,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return failure(error);
  }
}
