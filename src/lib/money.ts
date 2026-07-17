import { AppError } from "@/lib/errors";

const currencyExponents: Record<string, number> = {
  KES: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!currencyExponents[normalized]) {
    throw new AppError(
      "UNSUPPORTED_CURRENCY",
      "Currency " + normalized + " is not supported.",
      422,
    );
  }
  return normalized;
}

export function parseMinorAmount(value: string, currency: string): bigint {
  const normalizedCurrency = normalizeCurrency(currency);
  const exponent = currencyExponents[normalizedCurrency];
  const trimmed = value.trim();

  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(trimmed)) {
    throw new AppError("INVALID_AMOUNT", "Enter a positive amount with at most two decimal places.", 422);
  }

  const [whole, fractional = ""] = trimmed.split(".");
  const paddedFractional = fractional.padEnd(exponent, "0");
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(paddedFractional || "0");

  if (minor <= 0n) {
    throw new AppError("INVALID_AMOUNT", "Amount must be greater than zero.", 422);
  }

  return minor;
}

export function minorToDecimal(amountMinor: bigint, currency: string): string {
  const exponent = currencyExponents[normalizeCurrency(currency)];
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const divisor = 10n ** BigInt(exponent);
  const whole = absolute / divisor;
  const fractional = (absolute % divisor).toString().padStart(exponent, "0");
  return (negative ? "-" : "") + whole.toString() + "." + fractional;
}

export function formatMinorAmount(amountMinor: bigint, currency: string, locale = "en-KE"): string {
  const decimal = Number(minorToDecimal(amountMinor, currency));

  if (!Number.isSafeInteger(Math.trunc(decimal))) {
    return normalizeCurrency(currency) + " " + minorToDecimal(amountMinor, currency);
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizeCurrency(currency),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimal);
}

export function serializeMinor(amountMinor: bigint): string {
  return amountMinor.toString();
}
