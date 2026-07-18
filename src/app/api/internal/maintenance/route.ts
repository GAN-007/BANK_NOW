import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { failure, success } from "@/lib/http";
import { secureEqual } from "@/lib/crypto";
import { runMaintenance } from "@/lib/operations/maintenance";

export async function POST(request: Request) {
  try {
    const expected = getEnv().OPERATIONS_SECRET;
    if (!expected) {
      throw new AppError(
        "MAINTENANCE_DISABLED",
        "The maintenance endpoint is not configured.",
        503,
      );
    }
    const authorization = request.headers.get("authorization");
    const submitted = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    if (!submitted || !secureEqual(submitted, expected)) {
      throw new AppError("UNAUTHORIZED_OPERATION", "Valid operations credentials are required.", 401);
    }

    return success(await runMaintenance());
  } catch (error) {
    return failure(error);
  }
}
