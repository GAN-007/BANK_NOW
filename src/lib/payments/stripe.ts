import Stripe from "stripe";

import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

function stripeClient(): Stripe {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) {
    throw new AppError(
      "CARD_PAYMENTS_UNAVAILABLE",
      "Card payments are not configured yet.",
      503,
    );
  }
  return new Stripe(key);
}

export async function createStripeCheckout(input: {
  paymentIntentId: string;
  amountMinor: bigint;
  currency: string;
  customerEmail: string;
}): Promise<{ sessionId: string; checkoutUrl: string }> {
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const unitAmount = Number(input.amountMinor);
  if (!Number.isSafeInteger(unitAmount)) {
    throw new AppError("INVALID_AMOUNT", "The payment amount is too large.", 422);
  }
  const session = await stripeClient().checkout.sessions.create({
    mode: "payment",
    customer_email: input.customerEmail,
    success_url: appUrl + "/payments?status=processing",
    cancel_url: appUrl + "/payments?status=cancelled",
    metadata: {
      bankNowPaymentIntentId: input.paymentIntentId,
    },
    payment_intent_data: {
      metadata: {
        bankNowPaymentIntentId: input.paymentIntentId,
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: {
            name: "BANK NOW wallet funding",
          },
          unit_amount: unitAmount,
        },
      },
    ],
  });

  if (!session.url) {
    throw new AppError(
      "CARD_PAYMENTS_UNAVAILABLE",
      "The card payment session could not be created.",
      503,
    );
  }

  return {
    sessionId: session.id,
    checkoutUrl: session.url,
  };
}

export function verifyStripeWebhook(rawPayload: string, signature: string): Stripe.Event {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError("WEBHOOK_NOT_CONFIGURED", "Stripe webhook verification is not configured.", 503);
  }
  return stripeClient().webhooks.constructEvent(rawPayload, signature, secret);
}
