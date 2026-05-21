/**
 * GET /api/supervisor/overview?range=24h|7d|30d
 *
 * Aggregate KPIs for the supervisor dashboard. Gated to SUPERVISOR/ADMIN.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { computeSupervisorOverview, type SupervisorRange } from "@/server/supervisor";

const querySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireRole(["SUPERVISOR", "ADMIN"]);
    const url = new URL(req.url);
    const { range } = querySchema.parse({ range: url.searchParams.get("range") ?? undefined });
    const overview = await computeSupervisorOverview({ range: range as SupervisorRange });
    return ok(overview);
  })();
}
