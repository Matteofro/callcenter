/**
 * GET /api/dashboard/kpi?hours=24
 * Aggregate KPIs for supervisor dashboards. Open to OPERATOR/SUPERVISOR/ADMIN.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { computeDashboardKpi } from "@/server/kpi";

const querySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireSession();
    const url = new URL(req.url);
    const { hours } = querySchema.parse({ hours: url.searchParams.get("hours") ?? undefined });
    const kpi = await computeDashboardKpi({ sinceHours: hours });
    return ok(kpi);
  })();
}
