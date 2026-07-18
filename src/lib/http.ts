import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { AppError, asAppError, isAppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

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
    requestId: string;
  };
};

export function success<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function failure(error: unknown): NextResponse<ApiFailure> {
  const appError = asAppError(error);
  const requestId = randomUUID();
  if (!isAppError(error) || appError.status >= 500) {
    console.error("API request failed", {
      requestId,
      code: appError.code,
      status: appError.status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
  }
  const response = NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
        requestId,
      },
    },
    { status: appError.status },
  );
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let payload: unknown;

  try {
    payload = JSON.parse(await readRawText(request, 64 * 1024)) as unknown;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
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

export function parseJsonText<T>(rawPayload: string): T {
  try {
    return JSON.parse(rawPayload) as T;
  } catch {
    throw new AppError("INVALID_JSON", "Request body must contain valid JSON.", 400);
  }
}

export async function readRawText(
  request: Request,
  maximumBytes = 1024 * 1024,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
  }
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
    }
    chunks.push(result.value);
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw new AppError("INVALID_TEXT_ENCODING", "Request body must be valid UTF-8.", 400);
  }
}

export function requestIp(request: Request): string {
  const trustedProxyHops = getEnv().TRUSTED_PROXY_HOPS;
  if (trustedProxyHops <= 0) {
    return "unknown";
  }
  const addresses = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const index = addresses.length - trustedProxyHops;
  return index >= 0 ? addresses[index]! : "unknown";
}

export function requestUserAgent(request: Request): string | undefined {
  return request.headers.get("user-agent")?.slice(0, 512);
}
