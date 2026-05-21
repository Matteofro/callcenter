/**
 * Minimal structured logger. We intentionally don't pull in `pino` for the MVP
 * to keep dependencies small. Replace with pino if we need log shipping.
 *
 * IMPORTANT: never log raw phone numbers or emails — mask them.
 */

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, payload: Record<string, unknown>, msg: string): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...payload,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (payload: Record<string, unknown>, msg: string): void => {
    if (process.env.NODE_ENV === "development") emit("debug", payload, msg);
  },
  info: (payload: Record<string, unknown>, msg: string): void => emit("info", payload, msg),
  warn: (payload: Record<string, unknown>, msg: string): void => emit("warn", payload, msg),
  error: (payload: Record<string, unknown>, msg: string): void => emit("error", payload, msg),
};

/** Mask a phone number for safe logging: keeps country + last 2 digits. */
export function maskPhone(p: string | null | undefined): string {
  if (!p) return "";
  const clean = p.replace(/\s/g, "");
  if (clean.length < 5) return "***";
  return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

/** Mask an email for safe logging. */
export function maskEmail(e: string | null | undefined): string {
  if (!e) return "";
  const [u, d] = e.split("@");
  if (!d) return "***";
  return `${u.slice(0, 2)}***@${d}`;
}
