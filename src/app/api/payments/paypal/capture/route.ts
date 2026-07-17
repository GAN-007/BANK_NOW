import { type NextRequest } from "next/server";

import { PaymentIntentStatus, Provider } from "@/generated/prisma/client";
import { requireApiSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, readJson, success } from "@/lib/http";
import { capturePayPalOrder } from "@/lib/payments/paypal";
import { paypalCaptureSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession(request, { csrf: true });
    const input = await readJson(request, paypalCaptureSchema);
    const intent = await getDb().paymentIntent.findFirst({
      where: {
        userId: session.user.id,
        provider: Provider.PAYPAL,
        providerReference: input.orderId,
      },
    });

    if (!intent) {
      throw new AppError("PAYMENT_INTENT_NOT_FOUND", "This PayPal payment was not found.", 404);
    }
    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      return success({
        orderId: input.orderId,
        providerStatus: "COMPLETED",
        message: "This PayPal payment was already verified and credited.",
      });
    }
    if (
      intent.status === PaymentIntentStatus.FAILED ||
      intent.status === PaymentIntentStatus.CANCELLED ||
      (intent.expiresAt && intent.expiresAt <= new Date())
    ) {
      throw new AppError("PAYMENT_NOT_ACTIONABLE", "This PayPal payment can no longer be confirmed.", 409);
    }

    const capture = await capturePayPalOrder(input.orderId);
    return success({
      orderId: capture.orderId,
      providerStatus: capture.status,
      message: "PayPal confirmed the capture. Your balance updates after its signed webhook is processed.",
    });
  } catch (error) {
    return failure(error);
  }
}
