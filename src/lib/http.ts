import { NextResponse } from "next/server";
import type { z } from "zod";

import { AppError, asAppError } from "@/lib/errors";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
};

export function success<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function failure(error: unknown): NextResponse<ApiFailure> {
  const appError = asAppError(error);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
    },
    { status: appError.status },
  );
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "Request body must contain valid JSON.", 400);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = Object.fromEntries(
      parsed.error.issues.map((issue) => [
        issue.path.join(".") || "body",
        issue.message,
      ]),
    );
    throw new AppError("VALIDATION_ERROR", "Please correct the highlighted fields.", 422, details);
  }

  return parsed.data;
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
}

export function requestUserAgent(request: Request): string | undefined {
  return request.headers.get("user-agent")?.slice(0, 512);
}
