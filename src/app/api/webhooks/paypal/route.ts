import { Provider } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { AppError } from "@/lib/errors";
import { failure, success } from "@/lib/http";
import { parseMinorAmount } from "@/lib/money";
import { verifyPayPalWebhook } from "@/lib/payments/paypal";
import { beginWebhook, completeWebhook, rejectWebhook } from "@/lib/webhooks/store";

type PayPalWebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    amount?: {
      currency_code?: string;
      value?: string;
    };
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
};

export async function POST(request: Request) {
  const rawPayload = await request.text();
  const signatureValid = await verifyPayPalWebhook({
    rawPayload,
    headers: request.headers,
  });
  if (!signatureValid) {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Invalid PayPal signature.", 400));
  }

  const event = JSON.parse(rawPayload) as PayPalWebhookEvent;
  if (!event.id) {
    return failure(new AppError("INVALID_WEBHOOK_PAYLOAD", "PayPal event identifier is missing.", 400));
  }

  const webhook = await beginWebhook({
    provider: Provider.PAYPAL,
    externalEventId: event.id,
    rawPayload,
    signatureValid: true,
  });
  if (webhook.duplicate) {
    return success({ received: true });
  }

  try {
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
      if (!orderId) {
        throw new AppError("WEBHOOK_PAYMENT_MISMATCH", "PayPal capture did not include an order ID.", 409);
      }

      const intent = await getDb().paymentIntent.findFirst({
        where: {
          provider: Provider.PAYPAL,
          providerReference: orderId,
        },
      });
      const reportedAmount = event.resource?.amount;
      if (
        !intent ||
        !reportedAmount?.currency_code ||
        !reportedAmount.value ||
        reportedAmount.currency_code !== intent.currency ||
        parseMinorAmount(reportedAmount.value, reportedAmount.currency_code) !== intent.amountMinor
      ) {
        throw new AppError("WEBHOOK_PAYMENT_MISMATCH", "PayPal payment did not match a pending intent.", 409);
      }

      await settleFundingIntent({
        paymentIntentId: intent.id,
        providerReference: orderId,
      });
    }

    await completeWebhook(webhook.id, { success: true });
    return success({ received: true });
  } catch (error) {
    await rejectWebhook(
      webhook.id,
      error instanceof Error ? error.message : "Unknown PayPal webhook failure.",
    );
    return failure(error);
  }
}
