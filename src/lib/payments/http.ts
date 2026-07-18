import { getEnv } from "@/lib/env";

export function providerFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal:
      init.signal ?? AbortSignal.timeout(getEnv().PROVIDER_HTTP_TIMEOUT_MS),
  });
}
