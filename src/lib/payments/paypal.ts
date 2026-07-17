import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { minorToDecimal } from "@/lib/money";

type PayPalOrderResponse = {
  id: string;
  status?: string;
  links?: Array<{ href: string; rel: string }>;
};

type PayPalVerificationResponse = {
  verification_status: "SUCCESS" | "FAILURE";
};

function paypalBaseUrl(): string {
  return getEnv().PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(): Promise<string> {
  const environment = getEnv();
  if (!environment.PAYPAL_CLIENT_ID || !environment.PAYPAL_CLIENT_SECRET) {
    throw new AppError("PAYPAL_UNAVAILABLE", "PayPal is not configured yet.", 503);
  }

  const credentials = Buffer.from(
    environment.PAYPAL_CLIENT_ID + ":" + environment.PAYPAL_CLIENT_SECRET,
  ).toString("base64");
  const response = await fetch(paypalBaseUrl() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AppError("PAYPAL_UNAVAILABLE", "PayPal authorization failed.", 503);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new AppError("PAYPAL_UNAVAILABLE", "PayPal did not return an access token.", 503);
  }
  return body.access_token;
}

export async function createPayPalOrder(input: {
  paymentIntentId: string;
  amountMinor: bigint;
  currency: string;
}): Promise<{ orderId: string; approvalUrl: string }> {
  const token = await paypalAccessToken();
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const response = await fetch(paypalBaseUrl() + "/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "PayPal-Request-Id": input.paymentIntentId,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.paymentIntentId,
          amount: {
            currency_code: input.currency,
            value: minorToDecimal(input.amountMinor, input.currency),
          },
          description: "BANK NOW wallet funding",
        },
      ],
      application_context: {
        return_url: appUrl + "/payments?status=processing",
        cancel_url: appUrl + "/payments?status=cancelled",
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AppError("PAYPAL_UNAVAILABLE", "PayPal could not create the order.", 503);
  }

  const order = (await response.json()) as PayPalOrderResponse;
  const approvalUrl = order.links?.find((link) => link.rel === "approve")?.href;
  if (!order.id || !approvalUrl) {
    throw new AppError("PAYPAL_UNAVAILABLE", "PayPal returned an incomplete checkout order.", 503);
  }

  return {
    orderId: order.id,
    approvalUrl,
  };
}

/**
 * Captures an order only after PayPal has redirected the signed-in customer
 * back to BANK NOW. This endpoint deliberately does not credit a wallet: the
 * independently verified webhook remains the source of truth for settlement.
 */
export async function capturePayPalOrder(orderId: string): Promise<{
  orderId: string;
  status: string;
}> {
  const token = await paypalAccessToken();
  const response = await fetch(
    paypalBaseUrl() + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        // PayPal uses this value to safely deduplicate a retry of the same capture.
        "PayPal-Request-Id": orderId,
      },
      body: "{}",
      cache: "no-store",
    },
  );

  if (response.status === 422) {
    // A network retry can reach us after PayPal captured the order but before
    // the browser received our response. Read the provider state so that a
    // repeated confirmation is safely idempotent.
    const existing = await fetch(
      paypalBaseUrl() + "/v2/checkout/orders/" + encodeURIComponent(orderId),
      {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
      },
    );
    if (existing.ok) {
      const order = (await existing.json()) as PayPalOrderResponse;
      if (order.id && order.status === "COMPLETED") {
        return { orderId: order.id, status: order.status };
      }
    }
  }

  if (!response.ok) {
    throw new AppError("PAYPAL_CAPTURE_FAILED", "PayPal could not confirm this payment.", 409);
  }

  const order = (await response.json()) as PayPalOrderResponse;
  if (!order.id || !order.status) {
    throw new AppError("PAYPAL_CAPTURE_FAILED", "PayPal returned an incomplete payment result.", 503);
  }

  return {
    orderId: order.id,
    status: order.status,
  };
}

export async function verifyPayPalWebhook(input: {
  rawPayload: string;
  headers: Headers;
}): Promise<boolean> {
  const environment = getEnv();
  if (!environment.PAYPAL_WEBHOOK_ID) {
    throw new AppError("WEBHOOK_NOT_CONFIGURED", "PayPal webhook verification is not configured.", 503);
  }

  const token = await paypalAccessToken();
  const webhookEvent = JSON.parse(input.rawPayload) as unknown;
  const response = await fetch(
    paypalBaseUrl() + "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: input.headers.get("paypal-auth-algo"),
        cert_url: input.headers.get("paypal-cert-url"),
        transmission_id: input.headers.get("paypal-transmission-id"),
        transmission_sig: input.headers.get("paypal-transmission-sig"),
        transmission_time: input.headers.get("paypal-transmission-time"),
        webhook_id: environment.PAYPAL_WEBHOOK_ID,
        webhook_event: webhookEvent,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return false;
  }

  const body = (await response.json()) as PayPalVerificationResponse;
  return body.verification_status === "SUCCESS";
}
