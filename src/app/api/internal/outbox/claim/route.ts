import { requireOperationsCredential } from "@/lib/auth/operations";
import { claimOutbox } from "@/lib/domain/accounting-core";
import { failure, readJson, success } from "@/lib/http";
import { outboxClaimSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    requireOperationsCredential(request);
    const input = await readJson(request, outboxClaimSchema);
    return success(await claimOutbox(input.workerId, input.limit, input.leaseSeconds));
  } catch (error) {
    return failure(error);
  }
}
