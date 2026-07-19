import { AppError } from "@/lib/errors";

export function normalizeKenyanPhoneNumber(phoneNumber: string): string {
  let normalized = phoneNumber.replace(/[\s+()-]/g, "");
  if (/^0(7|1)\d{8}$/.test(normalized)) {
    normalized = "254" + normalized.slice(1);
  }
  if (!/^254(7|1)\d{8}$/.test(normalized)) {
    throw new AppError(
      "INVALID_KENYAN_PHONE",
      "Use a Kenyan mobile number in 07XXXXXXXX, 01XXXXXXXX, or 254XXXXXXXXX format.",
      422,
    );
  }
  return normalized;
}
