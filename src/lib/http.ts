/**
 * HTTP response helpers and a typed AppError class.
 *
 * Every route handler should wrap its logic in `handle()` so error mapping
 * is consistent and we never leak stack traces in production.
 *
 * User-facing messages are in Italian; internal `code` and `details` are in English.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export class AppError extends Error {
  status: number;
  code: string;
  /** Italian message shown to the operator */
  userMessage: string;
  details?: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    userMessage: string;
    details?: unknown;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.details = opts.details;
  }
}

export const errors = {
  badRequest: (message: string, userMessage = "Richiesta non valida.", details?: unknown) =>
    new AppError({ status: 400, code: "BAD_REQUEST", message, userMessage, details }),
  unauthorized: (message = "Unauthorized") =>
    new AppError({
      status: 401,
      code: "UNAUTHORIZED",
      message,
      userMessage: "Accesso non autorizzato. Effettua di nuovo il login.",
    }),
  forbidden: (message = "Forbidden") =>
    new AppError({
      status: 403,
      code: "FORBIDDEN",
      message,
      userMessage: "Non hai i permessi per questa operazione.",
    }),
  notFound: (entity: string) =>
    new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: `${entity} not found`,
      userMessage: `${entity} non trovato.`,
    }),
  conflict: (message: string, userMessage = "Conflitto rilevato.") =>
    new AppError({ status: 409, code: "CONFLICT", message, userMessage }),
  internal: (message = "Internal error") =>
    new AppError({
      status: 500,
      code: "INTERNAL_ERROR",
      message,
      userMessage: "Errore interno. Riprova tra qualche istante.",
    }),
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function err(e: AppError): NextResponse<ApiErr> {
  return NextResponse.json(
    {
      ok: false,
      error: { code: e.code, message: e.userMessage, details: e.details },
    },
    { status: e.status },
  );
}

/**
 * Wraps a route handler so any thrown error becomes a structured JSON response.
 * Use it for every route.
 */
export function handle<T>(fn: () => Promise<NextResponse<ApiOk<T> | ApiErr>>) {
  return async (): Promise<NextResponse<ApiOk<T> | ApiErr>> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) {
        logger.warn({ code: e.code, status: e.status, msg: e.message }, "AppError");
        return err(e);
      }
      if (e instanceof ZodError) {
        const flat = e.flatten();
        const ae = errors.badRequest(
          "Validation failed",
          "Dati non validi. Controlla i campi.",
          flat,
        );
        return err(ae);
      }
      logger.error({ err: serializeError(e) }, "Unhandled route error");
      return err(errors.internal());
    }
  };
}

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { value: String(e) };
}
