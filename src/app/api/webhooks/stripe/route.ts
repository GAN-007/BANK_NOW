import type Stripe from "stripe";

import { Provider } from "@/generated/prisma/client";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, success } from "@/lib/http";
import { verifyStripeWebhook } from "@/lib/payments/stripe";
import { beginWebhook, completeWebhook, rejectWebhook } from "@/lib/webhooks/store";

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | undefined {
  return session.metadata?.bankNowPaymentIntentId;
}

export async function POST(request: Request) {
  const rawPayload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Missing Stripe signature.", 400));
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(rawPayload, signature);
  } catch {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Invalid Stripe signature.", 400));
  }

  const webhook = await beginWebhook({
    provider: Provider.STRIPE,
    externalEventId: event.id,
    rawPayload,
    signatureValid: true,
  });
  if (webhook.duplicate) {
    return success({ received: true });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentIntentId = paymentIntentIdFromSession(session);
      if (!paymentIntentId || session.payment_status !== "paid") {
        await completeWebhook(webhook.id, { success: true });
        return success({ received: true });
      }

      const intent = await getDb().paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });
      if (
        !intent ||
        intent.provider !== Provider.STRIPE ||
        intent.providerReference !== session.id ||
        session.amount_total !== Number(intent.amountMinor) ||
        session.currency?.toUpperCase() !== intent.currency
      ) {
        throw new AppError("WEBHOOK_PAYMENT_MISMATCH", "Stripe payment did not match a pending intent.", 409);
      }

      await settleFundingIntent({
        paymentIntentId: intent.id,
        providerReference: session.id,
      });
    }

    await completeWebhook(webhook.id, { success: true });
    return success({ received: true });
  } catch (error) {
    await rejectWebhook(
      webhook.id,
      error instanceof Error ? error.message : "Unknown Stripe webhook failure.",
    );
    return failure(error);
  }
}
