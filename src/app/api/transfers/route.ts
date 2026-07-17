import { type NextRequest } from "next/server";

import { assertUserCanTransact, requireApiSession } from "@/lib/auth/session";
import { resolveDestinationAccount } from "@/lib/accounts";
import { postInternalTransfer } from "@/lib/domain/ledger";
import { failure, readJson, success } from "@/lib/http";
import { parseMinorAmount, serializeMinor } from "@/lib/money";
import { transferSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    assertUserCanTransact(session.user);
    const input = await readJson(request, transferSchema);
    const destination = await resolveDestinationAccount(input.destinationAccountNumber);
    const transfer = await postInternalTransfer({
      initiatorId: session.user.id,
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: destination.id,
      amountMinor: parseMinorAmount(input.amount, input.currency),
      currency: input.currency,
      memo: input.memo,
      idempotencyKey: input.idempotencyKey,
    });

    return success(
      {
        id: transfer.id,
        status: transfer.status,
        amountMinor: serializeMinor(transfer.amountMinor),
        currency: transfer.currency,
        createdAt: transfer.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
