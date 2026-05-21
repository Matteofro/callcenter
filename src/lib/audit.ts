/**
 * Audit log helper.
 *
 * We write audit entries explicitly from mutation paths (rather than via a
 * Prisma middleware) so the diff is meaningful: middlewares only see the
 * input `data`, not the previous row. Callers should pass the `before`/`after`
 * snapshots they already have at hand.
 */
import type { AuditSource } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AuditInput = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  source?: AuditSource;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: input.oldValue === undefined ? undefined : (input.oldValue as object),
      newValue: input.newValue === undefined ? undefined : (input.newValue as object),
      source: input.source ?? "USER",
      metadata: input.metadata ?? undefined,
    },
  });
}
