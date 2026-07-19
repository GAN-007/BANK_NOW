import { requireOperationsCredential } from "@/lib/auth/operations";
import { failure, success } from "@/lib/http";
import { runMaintenance } from "@/lib/operations/maintenance";

export async function POST(request: Request) {
  try {
    requireOperationsCredential(request);
    return success(await runMaintenance());
  } catch (error) {
    return failure(error);
  }
}
