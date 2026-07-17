import { type NextRequest } from "next/server";

import {
  clearSessionCookies,
  requireApiSession,
  revokeSessionByToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { failure, success } from "@/lib/http";

export async function POST(request: NextRequest) {
  try {
    await requireApiSession(request, { csrf: true });
    await revokeSessionByToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    const response = success({ signedOut: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return failure(error);
  }
}
