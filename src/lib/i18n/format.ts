/**
 * Locale-aware formatters for currency, dates and phone numbers.
 * Always show values in Italian conventions.
 */
import { format, formatDistanceToNow, formatRelative } from "date-fns";
import { it } from "date-fns/locale";

const EUR = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const PERCENT = new Intl.NumberFormat("it-IT", {
  style: "percent",
  maximumFractionDigits: 1,
});

const INT = new Intl.NumberFormat("it-IT");

/** Cents → "€ 24,90" */
export function formatEur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return EUR.format(cents / 100);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return PERCENT.format(value);
}

export function formatInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return INT.format(value);
}

/** "21/05/2026 17:42" */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd/MM/yyyy HH:mm", { locale: it });
}

/** "21/05/2026" */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd/MM/yyyy", { locale: it });
}

/** "3 minuti fa", "in 2 ore" */
export function formatRelativeIt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, { addSuffix: true, locale: it });
}

/** "oggi alle 14:30" or "venerdì alle 09:15" */
export function formatRelativeDay(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return formatRelative(date, new Date(), { locale: it });
}

/** "45s" or "2m 13s" or "1h 04m" */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}

/** "+39 320 1234567" → "+39 320 123 4567" (cosmetic only) */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return phone.replace(/\s+/g, " ").trim();
}
