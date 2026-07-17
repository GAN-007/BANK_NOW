import { type NextRequest } from "next/server";

import { Provider } from "@/generated/prisma/client";
import {
  requireApiSession,
  requireRole,
} from "@/lib/auth/session";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, readJson, success } from "@/lib/http";
import { settleBankTransferSchema } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    requireRole(session.user, ["FINANCE_ADMIN", "PLATFORM_ADMIN"]);
    const input = await readJson(request, settleBankTransferSchema);
    const { id } = await context.params;
    const intent = await getDb().paymentIntent.findUnique({
      where: { id },
    });
    if (!intent || intent.provider !== Provider.BANK_TRANSFER) {
      throw new AppError("PAYMENT_INTENT_NOT_FOUND", "Bank transfer was not found.", 404);
    }
    const settled = await settleFundingIntent({
      paymentIntentId: intent.id,
      providerReference: input.settlementReference,
    });
    return success(settled);
  } catch (error) {
    return failure(error);
  }
}
