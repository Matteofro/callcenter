/**
 * POST /api/cron/logydrop
 *
 * Triggered by Vercel Cron every 2 minutes (see vercel.json). Pulls the
 * current Logydrop order queue and reconciles it with our DB.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. Vercel injects this header
 * automatically when the cron is registered with the same secret.
 *
 * The endpoint is intentionally idempotent — running it twice in the same
 * minute is safe (LogisticsEvent.externalId uniqueness + per-order upsert).
 *
 * Also supports GET so an operator can hit it manually from the browser
 * (with the same Bearer token) to force a poll outside the cron tick.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { pollLogydrop } from "@/lib/logistics/adapters/logydrop";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// First run can fetch many pages of historical orders; bump well above the
// default 60s. Vercel Pro caps at 800s.
export const maxDuration = 800;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  // constant-time compare to avoid timing leaks
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < auth.length; i++) {
    diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    logger.warn({ ip: req.headers.get("x-forwarded-for") }, "Cron auth failed");
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Forbidden" } }, { status: 401 });
  }

  try {
    const summary = await pollLogydrop();
    return NextResponse.json({ ok: true, data: summary });
  } catch (e) {
    logger.error({ err: String(e) }, "Cron logydrop failed");
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Polling failed", details: String(e) } },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
