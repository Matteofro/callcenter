/**
 * GET  /api/admin/users
 *   List active (non-deleted) users with last login and call counts.
 *
 * POST /api/admin/users
 *   Create a new user. Email must be unique. Password is bcrypt-hashed (cost 12).
 *
 * Role gate: ADMIN only.
 */
import type { NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { handle, ok, errors } from "@/lib/http";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { userCreateSchema } from "@/lib/validation/user";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 12;

export async function GET() {
  return handle(async () => {
    await requireRole(["ADMIN"]);

    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: "asc" }, { role: "asc" }, { fullName: "asc" }],
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { calls: true } },
      },
    });

    return ok({ users });
  })();
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await requireRole(["ADMIN"]);
    const parsed = userCreateSchema.parse(await req.json());

    try {
      const passwordHash = await hash(parsed.password, BCRYPT_COST);
      const user = await prisma.user.create({
        data: {
          email: parsed.email,
          fullName: parsed.fullName,
          role: parsed.role,
          status: parsed.status,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      await writeAudit({
        userId: session.user.id,
        action: "user.create",
        entityType: "User",
        entityId: user.id,
        newValue: { email: user.email, role: user.role, status: user.status },
      });

      return ok(user, { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw errors.conflict(
          "duplicate email",
          "Un utente con questa email esiste già.",
        );
      }
      throw e;
    }
  })();
}
