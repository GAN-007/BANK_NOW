import { secureEqual } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export function requireOperationsCredential(request: Request): void {
  const expected = getEnv().OPERATIONS_SECRET;
  if (!expected) {
    throw new AppError("OPERATIONS_DISABLED", "Operations endpoints are not configured.", 503);
  }
  const authorization = request.headers.get("authorization");
  const submitted = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  if (!submitted || !secureEqual(submitted, expected)) {
    throw new AppError("UNAUTHORIZED_OPERATION", "Valid operations credentials are required.", 401);
  }
}
