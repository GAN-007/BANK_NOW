import { AppError } from "@/lib/errors";
import { secureEqual } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { minorToDecimal } from "@/lib/money";

type MpesaStkResponse = {
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  CheckoutRequestID?: string;
};

function mpesaBaseUrl(): string {
  return getEnv().MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

function nairobiTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const component = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return (
    component("year") +
    component("month") +
    component("day") +
    component("hour") +
    component("minute") +
    component("second")
  );
}

function normalizedPhoneNumber(phoneNumber: string): string {
  const normalized = phoneNumber.replace(/[\s+()-]/g, "");
  if (!/^254(7|1)\d{8}$/.test(normalized)) {
    throw new AppError(
      "INVALID_MPESA_PHONE",
      "Use a Kenyan M-Pesa number in 2547XXXXXXXX or 2541XXXXXXXX format.",
      422,
    );
  }
  return normalized;
}

async function mpesaAccessToken(): Promise<string> {
  const environment = getEnv();
  if (!environment.MPESA_CONSUMER_KEY || !environment.MPESA_CONSUMER_SECRET) {
    throw new AppError("MPESA_UNAVAILABLE", "M-Pesa is not configured yet.", 503);
  }

  const credentials = Buffer.from(
    environment.MPESA_CONSUMER_KEY + ":" + environment.MPESA_CONSUMER_SECRET,
  ).toString("base64");
  const response = await fetch(
    mpesaBaseUrl() + "/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: "Basic " + credentials,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new AppError("MPESA_UNAVAILABLE", "M-Pesa authorization failed.", 503);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new AppError("MPESA_UNAVAILABLE", "M-Pesa did not return an access token.", 503);
  }
  return body.access_token;
}

export async function initiateMpesaStkPush(input: {
  paymentIntentId: string;
  amountMinor: bigint;
  currency: string;
  phoneNumber: string;
}): Promise<{ checkoutRequestId: string; customerMessage: string }> {
  const environment = getEnv();
  if (
    !environment.MPESA_SHORTCODE ||
    !environment.MPESA_PASSKEY ||
    !environment.MPESA_CALLBACK_URL ||
    !environment.MPESA_CALLBACK_SECRET
  ) {
    throw new AppError("MPESA_UNAVAILABLE", "M-Pesa is not configured yet.", 503);
  }

  if (input.currency !== "KES") {
    throw new AppError("CURRENCY_MISMATCH", "M-Pesa funding is available only in KES.", 422);
  }

  const decimalAmount = Number(minorToDecimal(input.amountMinor, input.currency));
  if (!Number.isSafeInteger(decimalAmount) || decimalAmount < 1) {
    throw new AppError("INVALID_AMOUNT", "M-Pesa amounts must be whole Kenyan shillings.", 422);
  }

  const timestamp = nairobiTimestamp();
  const password = Buffer.from(
    environment.MPESA_SHORTCODE + environment.MPESA_PASSKEY + timestamp,
  ).toString("base64");
  const callbackUrl = new URL(environment.MPESA_CALLBACK_URL);
  callbackUrl.searchParams.set("token", environment.MPESA_CALLBACK_SECRET);

  const response = await fetch(mpesaBaseUrl() + "/mpesa/stkpush/v1/processrequest", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + (await mpesaAccessToken()),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: environment.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: decimalAmount,
      PartyA: normalizedPhoneNumber(input.phoneNumber),
      PartyB: environment.MPESA_SHORTCODE,
      PhoneNumber: normalizedPhoneNumber(input.phoneNumber),
      CallBackURL: callbackUrl.toString(),
      AccountReference: input.paymentIntentId.slice(-12).toUpperCase(),
      TransactionDesc: "BANK NOW wallet funding",
    }),
    cache: "no-store",
  });

  const body = (await response.json()) as MpesaStkResponse;
  if (!response.ok || body.ResponseCode !== "0" || !body.CheckoutRequestID) {
    throw new AppError(
      "MPESA_UNAVAILABLE",
      body.ResponseDescription || "M-Pesa could not initiate the payment request.",
      503,
    );
  }

  return {
    checkoutRequestId: body.CheckoutRequestID,
    customerMessage: body.CustomerMessage || "Approve the M-Pesa prompt on your phone.",
  };
}

export function verifyMpesaCallbackToken(token: string | null): boolean {
  const expected = getEnv().MPESA_CALLBACK_SECRET;
  return Boolean(expected && token && secureEqual(token, expected));
}
