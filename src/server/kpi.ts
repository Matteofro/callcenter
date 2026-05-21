/**
 * Dashboard KPI computation.
 *
 * Keep these as a single function so we can later cache by `windowStart`.
 * All counts are scoped to the given time window (defaults to last 24h).
 */
import { prisma } from "@/lib/db";

export type DashboardKpi = {
  windowStart: string;
  windowEnd: string;
  callsTotal: number;
  callsAnswered: number;
  /** answered / total */
  contactRate: number;
  callsConfirmed: number;
  /** orders confirmed / answered calls */
  conversionRate: number;
  upsellsAccepted: number;
  upsellsTotal: number;
  upsellRate: number;
  extraRevenueCents: number;
  openLogisticsIssues: number;
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

export async function computeDashboardKpi(opts?: { sinceHours?: number }): Promise<DashboardKpi> {
  const sinceHours = opts?.sinceHours ?? 24;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - sinceHours * 3600_000);

  const [
    callsTotal,
    callsAnswered,
    callsConfirmed,
    upsellsAccepted,
    upsellsTotal,
    extraAgg,
    openLogisticsIssues,
  ] = await Promise.all([
    prisma.call.count({ where: { createdAt: { gte: windowStart } } }),
    prisma.call.count({
      where: { createdAt: { gte: windowStart }, status: { in: [...ANSWERED_STATUSES] } },
    }),
    prisma.call.count({
      where: { createdAt: { gte: windowStart }, status: "ORDER_CONFIRMED" },
    }),
    prisma.upsellOutcome.count({
      where: { createdAt: { gte: windowStart }, outcome: "ACCEPTED" },
    }),
    prisma.upsellOutcome.count({ where: { createdAt: { gte: windowStart } } }),
    prisma.upsellOutcome.aggregate({
      where: { createdAt: { gte: windowStart }, outcome: "ACCEPTED" },
      _sum: { extraValueCents: true },
    }),
    prisma.shipment.count({
      where: {
        OR: [{ isDelayed: true }, { isRefused: true }, { isLost: true }, { isReturned: true }],
        deliveryStatus: { notIn: ["DELIVERED", "RETURNED"] },
      },
    }),
  ]);

  const contactRate = callsTotal > 0 ? callsAnswered / callsTotal : 0;
  const conversionRate = callsAnswered > 0 ? callsConfirmed / callsAnswered : 0;
  const upsellRate = upsellsTotal > 0 ? upsellsAccepted / upsellsTotal : 0;

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    callsTotal,
    callsAnswered,
    contactRate,
    callsConfirmed,
    conversionRate,
    upsellsAccepted,
    upsellsTotal,
    upsellRate,
    extraRevenueCents: extraAgg._sum.extraValueCents ?? 0,
    openLogisticsIssues,
  };
}
