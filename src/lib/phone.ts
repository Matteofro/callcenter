/**
 * Phone number normalization to E.164.
 *
 * We always store BOTH the normalized form (`phoneE164`) and the raw input
 * (`phoneRaw`) so we can fall back to display the operator's original number
 * if normalization fails.
 */
import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

const DEFAULT_COUNTRY = (process.env.DEFAULT_PHONE_COUNTRY ?? "IT") as CountryCode;

export type NormalizedPhone = {
  e164: string;
  raw: string;
  country: string;
};

/**
 * Normalize a phone string to E.164. Throws if the input is not a valid number.
 * The caller should catch and present an Italian error to the operator.
 */
export function normalizePhone(input: string, country: CountryCode = DEFAULT_COUNTRY): NormalizedPhone {
  const trimmed = input.trim();
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) {
    throw new Error(`Invalid phone number: ${trimmed}`);
  }
  return {
    e164: parsed.number,
    raw: trimmed,
    country: parsed.country ?? country,
  };
}

/** Soft variant that returns null on failure — useful for search/lookup paths. */
export function tryNormalizePhone(input: string, country: CountryCode = DEFAULT_COUNTRY): NormalizedPhone | null {
  try {
    return normalizePhone(input, country);
  } catch {
    return null;
  }
}
