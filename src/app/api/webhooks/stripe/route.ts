import type Stripe from "stripe";

import { Provider } from "@/generated/prisma/client";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { failure, readRawText, success } from "@/lib/http";
import { verifyStripeWebhook } from "@/lib/payments/stripe";
import {
  beginWebhook,
  completeWebhook,
  failWebhook,
  isPermanentWebhookFailure,
  rejectWebhook,
} from "@/lib/webhooks/store";

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | undefined {
  return session.metadata?.bankNowPaymentIntentId;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Missing Stripe signature.", 400));
  }

  let rawPayload: string;
  try {
    rawPayload = await readRawText(request);
  } catch (error) {
    return failure(error);
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(rawPayload, signature);
  } catch {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Invalid Stripe signature.", 400));
  }

  try {
    const webhook = await beginWebhook({
      provider: Provider.STRIPE,
      externalEventId: event.id,
      rawPayload,
      signatureValid: true,
    });
    if (webhook.disposition === "in_progress") {
      return failure(
        new AppError("WEBHOOK_IN_PROGRESS", "This event is already being processed.", 503),
      );
    }
    if (webhook.disposition !== "claimed") {
      return success({ received: true });
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentIntentId = paymentIntentIdFromSession(session);
      if (!paymentIntentId || session.payment_status !== "paid") {
        await completeWebhook(webhook.id);
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
        if (intent && intent.status !== "SUCCEEDED") {
          await getDb().paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: "MANUAL_REVIEW",
              failureCode: "STRIPE_PAYMENT_MISMATCH",
            },
          });
        }
        throw new AppError("WEBHOOK_PAYMENT_MISMATCH", "Stripe payment did not match a pending intent.", 409);
      }

      await settleFundingIntent({
        paymentIntentId: intent.id,
        settlementReference: session.id,
      });
    }

    await completeWebhook(webhook.id);
    return success({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe webhook failure.";
    const existing = await getDb().providerWebhook.findUnique({
      where: {
        provider_externalEventId: {
          provider: Provider.STRIPE,
          externalEventId: event.id,
        },
      },
      select: { id: true, status: true },
    });
    if (isPermanentWebhookFailure(error)) {
      if (existing?.status === "RECEIVED") {
        await rejectWebhook(existing.id, message);
      }
      return success({ received: true, manualReview: true });
    }
    if (existing?.status === "RECEIVED") {
      await failWebhook(existing.id, message);
    }
    return failure(error);
  }
}
