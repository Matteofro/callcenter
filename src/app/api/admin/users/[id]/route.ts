/**
 * GET    /api/admin/users/:id  — single user detail
 * PATCH  /api/admin/users/:id  — update name / role / status / password
 * DELETE /api/admin/users/:id  — soft delete (sets deletedAt, status=INACTIVE)
 *
 * Role gate: ADMIN only.
 * Safety: admins cannot demote / deactivate / delete themselves to avoid
 * locking everyone out of the system.
 */
import type { NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { handle, ok, errors } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { userUpdateSchema } from "@/lib/validation/user";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 12;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireRole(["ADMIN"]);
    const { id } = await ctx.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
        _count: { select: { calls: true } },
      },
    });
    if (!user || user.deletedAt) throw errors.notFound("Utente");

    return ok({ user });
  })();
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireRole(["ADMIN"]);
    const { id } = await ctx.params;
    const parsed = userUpdateSchema.parse(await req.json());

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw errors.notFound("Utente");

    // Self-protection: an admin cannot demote or deactivate themselves
    if (existing.id === session.user.id) {
      if (parsed.role && parsed.role !== "ADMIN") {
        throw errors.badRequest(
          "self-demote",
          "Non puoi modificare il tuo stesso ruolo.",
        );
      }
      if (parsed.status && parsed.status !== "ACTIVE") {
        throw errors.badRequest(
          "self-deactivate",
          "Non puoi disattivare il tuo stesso account.",
        );
      }
    }

    const data: {
      fullName?: string;
      role?: typeof existing.role;
      status?: typeof existing.status;
      passwordHash?: string;
    } = {};
    if (parsed.fullName !== undefined) data.fullName = parsed.fullName;
    if (parsed.role !== undefined) data.role = parsed.role;
    if (parsed.status !== undefined) data.status = parsed.status;
    if (parsed.password !== undefined) {
      data.passwordHash = await hash(parsed.password, BCRYPT_COST);
    }

    if (Object.keys(data).length === 0) {
      throw errors.badRequest("empty patch", "Nessun campo da aggiornare.");
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: {
        id: true, email: true, fullName: true, role: true, status: true, createdAt: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "user.update",
      entityType: "User",
      entityId: updated.id,
      oldValue: {
        fullName: existing.fullName,
        role: existing.role,
        status: existing.status,
      },
      newValue: {
        fullName: updated.fullName,
        role: updated.role,
        status: updated.status,
        passwordChanged: parsed.password !== undefined ? true : undefined,
      },
    });

    return ok(updated);
  })();
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireRole(["ADMIN"]);
    const { id } = await ctx.params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw errors.notFound("Utente");

    if (existing.id === session.user.id) {
      throw errors.badRequest(
        "self-delete",
        "Non puoi eliminare il tuo stesso account.",
      );
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), status: "INACTIVE" },
    });

    await writeAudit({
      userId: session.user.id,
      action: "user.delete",
      entityType: "User",
      entityId: existing.id,
      oldValue: { email: existing.email, role: existing.role, status: existing.status },
    });

    return ok({ ok: true });
  })();
}
