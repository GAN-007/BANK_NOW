import { type NextRequest } from "next/server";

import { requireApiSession } from "@/lib/auth/session";
import { failure, readJson, success } from "@/lib/http";
import { confirmMfaEnrollment } from "@/lib/mfa/totp";
import { mfaCodeSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const input = await readJson(request, mfaCodeSchema);
    await confirmMfaEnrollment({
      userId: session.user.id,
      email: session.user.email,
      code: input.code,
    });
    return success({ enabled: true });
  } catch (error) {
    return failure(error);
  }
}
