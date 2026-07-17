import { type NextRequest } from "next/server";

import { assertUserCanTransact, requireApiSession } from "@/lib/auth/session";
import { failure, readJson, success } from "@/lib/http";
import {
  createFundingIntent,
  listFundingIntents,
} from "@/lib/payments/service";
import { fundingSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession(request);
    return success(await listFundingIntents(session.user.id));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    assertUserCanTransact(session.user);
    const input = await readJson(request, fundingSchema);
    return success(
      await createFundingIntent(session.user, input),
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
