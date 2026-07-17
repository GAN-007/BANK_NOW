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
import { mfaLoginSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, mfaLoginSchema);
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
