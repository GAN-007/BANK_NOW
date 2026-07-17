import { type NextRequest } from "next/server";

import { verifyEmail } from "@/lib/auth/service";
import { failure, readJson, success } from "@/lib/http";
import { verifyEmailSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, verifyEmailSchema);
    await verifyEmail(input.token);
    return success({ verified: true });
  } catch (error) {
    return failure(error);
  }
}
