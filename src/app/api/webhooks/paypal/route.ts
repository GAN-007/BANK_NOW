import { Provider } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { settleFundingIntent } from "@/lib/domain/ledger";
import { AppError } from "@/lib/errors";
import { failure, parseJsonText, readRawText, success } from "@/lib/http";
import { parseMinorAmount } from "@/lib/money";
import { verifyPayPalWebhook } from "@/lib/payments/paypal";
import {
  beginWebhook,
  completeWebhook,
  failWebhook,
  isPermanentWebhookFailure,
  rejectWebhook,
} from "@/lib/webhooks/store";

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
  let rawPayload: string;
  let event: PayPalWebhookEvent;
  let signatureValid: boolean;
  try {
    rawPayload = await readRawText(request);
    event = parseJsonText<PayPalWebhookEvent>(rawPayload);
    signatureValid = await verifyPayPalWebhook({
      rawPayload,
      headers: request.headers,
    });
  } catch (error) {
    return failure(error);
  }
  if (!signatureValid) {
    return failure(new AppError("INVALID_WEBHOOK_SIGNATURE", "Invalid PayPal signature.", 400));
  }

  if (!event.id) {
    return failure(new AppError("INVALID_WEBHOOK_PAYLOAD", "PayPal event identifier is missing.", 400));
  }

  try {
    const webhook = await beginWebhook({
      provider: Provider.PAYPAL,
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
        if (intent && intent.status !== "SUCCEEDED") {
          await getDb().paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: "MANUAL_REVIEW",
              failureCode: "PAYPAL_PAYMENT_MISMATCH",
            },
          });
        }
        throw new AppError("WEBHOOK_PAYMENT_MISMATCH", "PayPal payment did not match a pending intent.", 409);
      }

      await settleFundingIntent({
        paymentIntentId: intent.id,
        settlementReference: orderId,
      });
    }

    await completeWebhook(webhook.id);
    return success({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PayPal webhook failure.";
    const existing = await getDb().providerWebhook.findUnique({
      where: {
        provider_externalEventId: {
          provider: Provider.PAYPAL,
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
