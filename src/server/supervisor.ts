/**
 * Server-side aggregations for the supervisor dashboard.
 *
 * All queries are bounded by a time window. Per-operator stats are computed
 * in a single groupBy to keep the page snappy even with thousands of calls.
 */
import { prisma } from "@/lib/db";

export type SupervisorRange = "24h" | "7d" | "30d";

export function rangeToHours(range: SupervisorRange): number {
  switch (range) {
    case "24h":
      return 24;
    case "7d":
      return 24 * 7;
    case "30d":
      return 24 * 30;
  }
}

export type OperatorStat = {
  operatorId: string;
  fullName: string;
  callsTotal: number;
  callsAnswered: number;
  callsConfirmed: number;
  contactRate: number;
  conversionRate: number;
  avgDurationSec: number;
  upsellsAccepted: number;
  extraRevenueCents: number;
};

export type TrendBucket = {
  /** ISO timestamp at the start of the bucket */
  bucket: string;
  callsTotal: number;
  callsAnswered: number;
  callsConfirmed: number;
};

export type TopOutcome = {
  status: string;
  count: number;
};

export type ActivityRow = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  source: string;
  user: { id: string; fullName: string } | null;
};

export type SupervisorOverview = {
  range: SupervisorRange;
  windowStart: string;
  windowEnd: string;
  totals: {
    callsTotal: number;
    callsAnswered: number;
    callsConfirmed: number;
    contactRate: number;
    conversionRate: number;
    upsellsAccepted: number;
    upsellsTotal: number;
    upsellRate: number;
    extraRevenueCents: number;
    openLogisticsIssues: number;
    activeOperators: number;
  };
  operators: OperatorStat[];
  trend: TrendBucket[];
  topNonConversion: TopOutcome[];
  recentActivity: ActivityRow[];
};

const ANSWERED_STATUSES = [
  "ANSWERED",
  "ORDER_CONFIRMED",
  "ORDER_CANCELLED",
  "RETURN_REQUESTED",
  "REFUND_REQUESTED",
  "SHIPPING_ISSUE",
  "UPSELL_DONE",
  "CROSSSELL_DONE",
  "NOT_INTERESTED",
  "COMPLAINT_OPENED",
  "CASE_RESOLVED",
] as const;

const NON_CONVERSION_STATUSES = [
  "ORDER_CANCELLED",
  "RETURN_REQUESTED",
  "REFUND_REQUESTED",
  "NOT_INTERESTED",
  "COMPLAINT_OPENED",
  "WRONG_NUMBER",
  "NO_ANSWER",
] as const;

export async function computeSupervisorOverview(opts: { range: SupervisorRange }): Promise<SupervisorOverview> {
  const hours = rangeToHours(opts.range);
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - hours * 3600_000);

  const [calls, upsells, openIssues, allOperators, activity] = await Promise.all([
    prisma.call.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        id: true,
        status: true,
        operatorId: true,
        durationSec: true,
        startedAt: true,
        createdAt: true,
      },
    }),
    prisma.upsellOutcome.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { outcome: true, extraValueCents: true },
    }),
    prisma.shipment.count({
      where: {
        OR: [{ isDelayed: true }, { isRefused: true }, { isLost: true }, { isReturned: true }],
        deliveryStatus: { notIn: ["DELIVERED", "RETURNED"] },
      },
    }),
    prisma.user.findMany({
      where: { role: "OPERATOR", status: "ACTIVE", deletedAt: null },
      select: { id: true, fullName: true },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: windowStart } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { id: true, fullName: true } } },
    }),
  ]);

  // ─── Totals ────────────────────────────────────────────────────────────
  const callsTotal = calls.length;
  const callsAnswered = calls.filter((c) => (ANSWERED_STATUSES as readonly string[]).includes(c.status)).length;
  const callsConfirmed = calls.filter((c) => c.status === "ORDER_CONFIRMED").length;
  const upsellsAccepted = upsells.filter((u) => u.outcome === "ACCEPTED").length;
  const upsellsTotal = upsells.length;
  const extraRevenueCents = upsells
    .filter((u) => u.outcome === "ACCEPTED")
    .reduce((a, u) => a + u.extraValueCents, 0);

  const activeOperatorIds = new Set(calls.map((c) => c.operatorId));

  // ─── Per-operator stats ────────────────────────────────────────────────
  const operatorMap = new Map<string, OperatorStat>();
  for (const op of allOperators) {
    operatorMap.set(op.id, {
      operatorId: op.id,
      fullName: op.fullName,
      callsTotal: 0,
      callsAnswered: 0,
      callsConfirmed: 0,
      contactRate: 0,
      conversionRate: 0,
      avgDurationSec: 0,
      upsellsAccepted: 0,
      extraRevenueCents: 0,
    });
  }

  const durationsByOperator = new Map<string, number[]>();
  for (const c of calls) {
    const stat = operatorMap.get(c.operatorId);
    if (!stat) continue;
    stat.callsTotal += 1;
    if ((ANSWERED_STATUSES as readonly string[]).includes(c.status)) stat.callsAnswered += 1;
    if (c.status === "ORDER_CONFIRMED") stat.callsConfirmed += 1;
    if (c.durationSec) {
      const arr = durationsByOperator.get(c.operatorId) ?? [];
      arr.push(c.durationSec);
      durationsByOperator.set(c.operatorId, arr);
    }
  }
  // Operator-level upsell aggregation requires joining via the call → operator
  // link. We fetch it separately to keep the main query simple.
  const upsellByOperator = await prisma.upsellOutcome.findMany({
    where: { createdAt: { gte: windowStart } },
    select: { extraValueCents: true, outcome: true, call: { select: { operatorId: true } } },
  });
  for (const u of upsellByOperator) {
    const stat = operatorMap.get(u.call.operatorId);
    if (!stat) continue;
    if (u.outcome === "ACCEPTED") {
      stat.upsellsAccepted += 1;
      stat.extraRevenueCents += u.extraValueCents;
    }
  }

  for (const stat of operatorMap.values()) {
    stat.contactRate = stat.callsTotal > 0 ? stat.callsAnswered / stat.callsTotal : 0;
    stat.conversionRate = stat.callsAnswered > 0 ? stat.callsConfirmed / stat.callsAnswered : 0;
    const durations = durationsByOperator.get(stat.operatorId);
    stat.avgDurationSec =
      durations && durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  }

  const operators = Array.from(operatorMap.values()).sort((a, b) => b.callsTotal - a.callsTotal);

  // ─── Trend buckets ─────────────────────────────────────────────────────
  // 24 hourly buckets for 24h, 7 daily for 7d, 30 daily for 30d.
  const trend = buildTrendBuckets(calls, opts.range, windowStart);

  // ─── Top non-conversion reasons ────────────────────────────────────────
  const reasonMap = new Map<string, number>();
  for (const c of calls) {
    if ((NON_CONVERSION_STATUSES as readonly string[]).includes(c.status)) {
      reasonMap.set(c.status, (reasonMap.get(c.status) ?? 0) + 1);
    }
  }
  const topNonConversion: TopOutcome[] = Array.from(reasonMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // ─── Recent activity (audit log) ───────────────────────────────────────
  const recentActivity: ActivityRow[] = activity.map((a) => ({
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    source: a.source,
    user: a.user ? { id: a.user.id, fullName: a.user.fullName } : null,
  }));

  return {
    range: opts.range,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totals: {
      callsTotal,
      callsAnswered,
      callsConfirmed,
      contactRate: callsTotal > 0 ? callsAnswered / callsTotal : 0,
      conversionRate: callsAnswered > 0 ? callsConfirmed / callsAnswered : 0,
      upsellsAccepted,
      upsellsTotal,
      upsellRate: upsellsTotal > 0 ? upsellsAccepted / upsellsTotal : 0,
      extraRevenueCents,
      openLogisticsIssues: openIssues,
      activeOperators: activeOperatorIds.size,
    },
    operators,
    trend,
    topNonConversion,
    recentActivity,
  };
}

function buildTrendBuckets(
  calls: Array<{ status: string; createdAt: Date }>,
  range: SupervisorRange,
  windowStart: Date,
): TrendBucket[] {
  const isHourly = range === "24h";
  const buckets = isHourly ? 24 : range === "7d" ? 7 : 30;
  const stepMs = isHourly ? 3600_000 : 86_400_000;

  // Snap windowStart to bucket boundary
  const start = new Date(windowStart);
  if (isHourly) start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);

  const out: TrendBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    out.push({
      bucket: new Date(start.getTime() + i * stepMs).toISOString(),
      callsTotal: 0,
      callsAnswered: 0,
      callsConfirmed: 0,
    });
  }

  for (const c of calls) {
    const idx = Math.floor((c.createdAt.getTime() - start.getTime()) / stepMs);
    if (idx < 0 || idx >= out.length) continue;
    const b = out[idx]!;
    b.callsTotal += 1;
    if ((ANSWERED_STATUSES as readonly string[]).includes(c.status)) b.callsAnswered += 1;
    if (c.status === "ORDER_CONFIRMED") b.callsConfirmed += 1;
  }

  return out;
}
