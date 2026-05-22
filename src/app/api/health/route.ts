/**
 * GET /api/health
 *
 * Public health endpoint — verifies DB connectivity, Logydrop token status,
 * last poll timestamp, and overall service health. Used by:
 *   - Vercel "Health" page
 *   - External uptime monitoring (Better Uptime, UptimeRobot, etc.)
 *   - Manual smoke tests after deploy
 *
 * NOT auth-gated (so monitors don't need credentials), but exposes only
 * non-sensitive aggregate info. Never returns credentials, tokens, or PII.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthStatus = "ok" | "degraded" | "down";

interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail?: string;
  meta?: Record<string, unknown>;
}

export async function GET() {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];

  // ─── Database ──────────────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      name: "database",
      status: "ok",
      meta: { latencyMs: Date.now() - t0 },
    });
  } catch (e) {
    checks.push({
      name: "database",
      status: "down",
      detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }

  // ─── Logydrop integration ─────────────────────────────────────────────
  try {
    const token = await prisma.systemToken.findUnique({
      where: { provider: "logydrop" },
    });
    if (!token) {
      checks.push({
        name: "logydrop",
        status: "degraded",
        detail: "Token mai inizializzato (poll non ancora eseguito)",
      });
    } else {
      const meta = (token.metadata as Record<string, unknown> | null) ?? {};
      const lastPollAt = typeof meta.lastPollAt === "string" ? new Date(meta.lastPollAt) : null;
      const minutesSinceLastPoll = lastPollAt
        ? Math.round((Date.now() - lastPollAt.getTime()) / 60_000)
        : null;
      const tokenExpiresInMin = Math.round((token.expiresAt.getTime() - Date.now()) / 60_000);

      // Cron runs every 2 min — degrade if no poll in >10 min, down if >30 min
      let status: HealthStatus = "ok";
      let detail: string | undefined;
      if (minutesSinceLastPoll === null) {
        status = "degraded";
        detail = "Nessun poll registrato";
      } else if (minutesSinceLastPoll > 30) {
        status = "down";
        detail = `Ultimo poll: ${minutesSinceLastPoll} minuti fa`;
      } else if (minutesSinceLastPoll > 10) {
        status = "degraded";
        detail = `Ultimo poll: ${minutesSinceLastPoll} minuti fa`;
      }

      checks.push({
        name: "logydrop",
        status,
        detail,
        meta: {
          minutesSinceLastPoll,
          tokenExpiresInMin,
          hasRefreshToken: !!token.refreshToken,
        },
      });
    }
  } catch (e) {
    checks.push({
      name: "logydrop",
      status: "down",
      detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }

  // ─── Overall ───────────────────────────────────────────────────────────
  const overall: HealthStatus = checks.some((c) => c.status === "down")
    ? "down"
    : checks.some((c) => c.status === "degraded")
      ? "degraded"
      : "ok";

  const body = {
    status: overall,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    checks,
  };

  return NextResponse.json(body, {
    status: overall === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
