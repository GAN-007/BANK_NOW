import { type NextRequest } from "next/server";

import {
  getSessionByToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { serializeCurrentUser } from "@/lib/auth/service";
import { failure, success } from "@/lib/http";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionByToken(
      request.cookies.get(SESSION_COOKIE_NAME)?.value,
    );
    return success({
      authenticated: Boolean(session),
      user: session ? serializeCurrentUser(session.user) : null,
    });
  } catch (error) {
    return failure(error);
  }
}
