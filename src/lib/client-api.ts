"use client";

type ApiSuccess<T> = {
  ok: true;
  data: T;
};

type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

function csrfToken(): string | undefined {
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("bank_now_csrf="))
    ?.split("=")[1];
}

function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === true &&
    "data" in value
  );
}

function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false &&
    "error" in value
  );
}

export async function clientRequest<T>(
  path: string,
  options: {
    method?: "DELETE" | "GET" | "POST";
    body?: unknown;
    csrf?: boolean;
  } = {},
): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.csrf) {
    const token = csrfToken();
    if (!token) {
      throw new Error("Security token is unavailable. Refresh the page and retry.");
    }
    headers.set("x-csrf-token", token);
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "same-origin",
  });
  const payload: unknown = await response.json();
  if (isApiSuccess<T>(payload)) {
    return payload.data;
  }
  if (isApiFailure(payload)) {
    throw new Error(payload.error.message);
  }
  throw new Error("The server returned an unexpected response.");
}
