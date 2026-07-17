import { type NextRequest } from "next/server";

import { requireApiSession } from "@/lib/auth/session";
import { failure, success } from "@/lib/http";
import { startMfaEnrollment } from "@/lib/mfa/totp";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const result = await startMfaEnrollment(session.user);
    return success(result, 201);
  } catch (error) {
    return failure(error);
  }
}
