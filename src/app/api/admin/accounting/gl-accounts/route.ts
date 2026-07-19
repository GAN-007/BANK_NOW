import type { NextRequest } from "next/server";

import { requireApiSession, requireRole } from "@/lib/auth/session";
import { configureGlAccount } from "@/lib/domain/accounting-core";
import { getDb } from "@/lib/db";
import { failure, readJson, success } from "@/lib/http";
import { glAccountConfigurationSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    return success(await getDb().glAccount.findMany({ orderBy: { code: "asc" } }));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["PLATFORM_ADMIN"]);
    const input = await readJson(request, glAccountConfigurationSchema);
    return success(await configureGlAccount({ ...input, actorId: session.user.id }), 201);
  } catch (error) {
    return failure(error);
  }
}
