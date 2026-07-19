import { requireOperationsCredential } from "@/lib/auth/operations";
import { completeOutbox } from "@/lib/domain/accounting-core";
import { failure, readJson, success } from "@/lib/http";
import { outboxCompletionSchema } from "@/lib/validators";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireOperationsCredential(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      readJson(request, outboxCompletionSchema),
    ]);
    return success(await completeOutbox({ messageId: id, ...input }));
  } catch (error) {
    return failure(error);
  }
}
