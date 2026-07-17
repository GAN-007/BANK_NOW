import { type NextRequest } from "next/server";

import { resetPassword } from "@/lib/auth/service";
import { failure, readJson, requestIp, success } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, resetPasswordSchema);
    await resetPassword({ ...input, ip: requestIp(request) });
    return success({ message: "Your password was reset. Sign in with the new password." });
  } catch (error) {
    return failure(error);
  }
}
