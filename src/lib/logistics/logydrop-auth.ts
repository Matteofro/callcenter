/**
 * Logydrop authentication module.
 *
 * Logydrop has no API keys — only username/password login. Their `/auth/sign-in`
 * endpoint returns two JWT cookies:
 *   ACCESS_TOKEN  (TTL ~24h, used for all calls)
 *   REFRESH_TOKEN (TTL ~48h, used to mint a new ACCESS_TOKEN without re-login)
 *
 * We cache the token in BOTH memory and the `SystemToken` table:
 *   - Memory cache avoids the DB roundtrip when the same Node instance polls again.
 *   - DB cache survives serverless cold starts and multi-instance deploys.
 *
 * Refresh policy:
 *   - If ACCESS_TOKEN has > 5 minutes left → use it
 *   - Else if REFRESH_TOKEN is still valid → POST /auth/refresh
 *   - Else → POST /auth/sign-in with credentials from env
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const PROVIDER = "logydrop";
const BASE_URL = "https://api.logydrop.com";
const REFRESH_BUFFER_MS = 5 * 60_000; // refresh 5 minutes before expiry

// Default lifetimes inferred from observed Set-Cookie semantics. The JWT itself
// carries the truth in its `exp` claim — we parse that when we have a token.
const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_REFRESH_TTL_MS = 48 * 60 * 60_000;

interface TokenSnapshot {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
}

// In-process cache — populated lazily.
const globalForCache = globalThis as unknown as { __logydropToken?: TokenSnapshot };

function nowPlus(ms: number): Date {
  return new Date(Date.now() + ms);
}

/** Decode the `exp` claim from a JWT (seconds-since-epoch) without verifying signature. */
function jwtExpDate(jwt: string): Date | null {
  try {
    const payloadB64 = jwt.split(".")[1];
    if (!payloadB64) return null;
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf-8");
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

/** Parse a Set-Cookie header into a name → value map. Multiple values supported. */
function parseSetCookies(raw: string[] | string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const line of list) {
    const [pair] = line.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

async function signIn(email: string, password: string): Promise<TokenSnapshot> {
  logger.info({ email: email.split("@")[0] + "@***" }, "Logydrop sign-in");
  const res = await fetch(`${BASE_URL}/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Logydrop sign-in failed: ${res.status} ${body.slice(0, 200)}`);
  }
  // Node's fetch exposes Set-Cookie via getSetCookie() in recent versions.
  const setCookies =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    res.headers.get("set-cookie")?.split(/,(?=[^ ])/) ??
    [];
  const cookies = parseSetCookies(setCookies);
  const accessToken = cookies["ACCESS_TOKEN"];
  const refreshToken = cookies["REFRESH_TOKEN"] ?? null;
  if (!accessToken) {
    throw new Error("Logydrop sign-in did not return ACCESS_TOKEN cookie");
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: jwtExpDate(accessToken) ?? nowPlus(DEFAULT_ACCESS_TTL_MS),
    refreshExpiresAt: refreshToken
      ? (jwtExpDate(refreshToken) ?? nowPlus(DEFAULT_REFRESH_TTL_MS))
      : null,
  };
}

async function refreshAccess(refreshToken: string): Promise<TokenSnapshot | null> {
  logger.info({}, "Logydrop refresh");
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Refresh cookie is scoped to /auth — we send it explicitly
      Cookie: `REFRESH_TOKEN=${refreshToken}`,
    },
    body: "{}",
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, "Logydrop refresh failed");
    return null;
  }
  const setCookies =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    res.headers.get("set-cookie")?.split(/,(?=[^ ])/) ??
    [];
  const cookies = parseSetCookies(setCookies);
  const newAccess = cookies["ACCESS_TOKEN"];
  if (!newAccess) return null;
  // Logydrop may rotate the refresh token too — fall back to the old one if not.
  const newRefresh = cookies["REFRESH_TOKEN"] ?? refreshToken;
  return {
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresAt: jwtExpDate(newAccess) ?? nowPlus(DEFAULT_ACCESS_TTL_MS),
    refreshExpiresAt: jwtExpDate(newRefresh) ?? nowPlus(DEFAULT_REFRESH_TTL_MS),
  };
}

async function persist(snapshot: TokenSnapshot, email: string): Promise<void> {
  await prisma.systemToken.upsert({
    where: { provider: PROVIDER },
    create: {
      provider: PROVIDER,
      accessToken: snapshot.accessToken,
      refreshToken: snapshot.refreshToken,
      expiresAt: snapshot.expiresAt,
      refreshExpiresAt: snapshot.refreshExpiresAt,
      metadata: { email },
    },
    update: {
      accessToken: snapshot.accessToken,
      refreshToken: snapshot.refreshToken,
      expiresAt: snapshot.expiresAt,
      refreshExpiresAt: snapshot.refreshExpiresAt,
      metadata: { email },
    },
  });
  globalForCache.__logydropToken = snapshot;
}

async function loadFromDb(): Promise<TokenSnapshot | null> {
  const row = await prisma.systemToken.findUnique({ where: { provider: PROVIDER } });
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
  };
}

/**
 * Returns a non-expired access token for api.logydrop.com.
 * Handles login, cache, refresh, fallback re-login.
 */
export async function getValidAccessToken(): Promise<string> {
  const email = process.env.LOGYDROP_EMAIL;
  const password = process.env.LOGYDROP_PASSWORD;
  if (!email || !password) {
    throw new Error("LOGYDROP_EMAIL / LOGYDROP_PASSWORD not configured");
  }

  // 1) Memory cache
  let snap = globalForCache.__logydropToken;

  // 2) DB cache (cold start)
  if (!snap) {
    snap = (await loadFromDb()) ?? undefined;
    if (snap) globalForCache.__logydropToken = snap;
  }

  // 3) Still valid? (with buffer)
  if (snap && snap.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return snap.accessToken;
  }

  // 4) Try refresh
  if (snap?.refreshToken && (!snap.refreshExpiresAt || snap.refreshExpiresAt.getTime() > Date.now())) {
    const refreshed = await refreshAccess(snap.refreshToken);
    if (refreshed) {
      await persist(refreshed, email);
      return refreshed.accessToken;
    }
  }

  // 5) Re-login
  const fresh = await signIn(email, password);
  await persist(fresh, email);
  return fresh.accessToken;
}

/** Convenience wrapper for authenticated GETs against api.logydrop.com. */
export async function logydropGet<T = unknown>(path: string): Promise<T> {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      Cookie: `ACCESS_TOKEN=${token}`,
    },
  });
  if (res.status === 401) {
    // Token rejected unexpectedly — wipe cache and retry once
    delete globalForCache.__logydropToken;
    const fresh = await getValidAccessToken();
    const retry = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json", Cookie: `ACCESS_TOKEN=${fresh}` },
    });
    if (!retry.ok) throw new Error(`Logydrop GET ${path}: ${retry.status}`);
    return (await retry.json()) as T;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Logydrop GET ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
