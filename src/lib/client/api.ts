/**
 * Minimal typed fetch wrapper used by client components.
 *
 * Handles the `{ ok, data | error }` envelope returned by our route handlers
 * and surfaces the Italian `error.message` directly so a caller can pipe it
 * to a toast without further work.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function apiFetch<T>(
  input: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: "Errore di rete. Riprova." },
    };
  }
  return json as ApiResult<T>;
}

export class ApiError extends Error {
  constructor(public code: string, public userMessage: string, public details?: unknown) {
    super(userMessage);
  }
}

/** Throws ApiError if the result is not ok. */
export async function apiOrThrow<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch<T>(input, init);
  if (!r.ok) throw new ApiError(r.error.code, r.error.message, r.error.details);
  return r.data;
}
