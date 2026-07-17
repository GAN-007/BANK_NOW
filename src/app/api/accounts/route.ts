import { type NextRequest } from "next/server";

import { listUserAccounts } from "@/lib/accounts";
import { requireApiSession } from "@/lib/auth/session";
import { failure, success } from "@/lib/http";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    return success(await listUserAccounts(session.user.id));
  } catch (error) {
    return failure(error);
  }
}
