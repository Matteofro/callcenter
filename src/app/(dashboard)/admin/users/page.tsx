/**
 * Admin — users list.
 *
 * Server-rendered. Shows count, role distribution, and the full table.
 */
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { UsersTable, type UserRow } from "@/components/admin/UsersTable";
import { prisma } from "@/lib/db";
import { Plus, Users as UsersIcon } from "lucide-react";
import RealtimeRefresh from "../../RealtimeRefresh.client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  const currentUserId = session?.user.id ?? "";

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

  const totals = {
    operators: users.filter((u) => u.role === "OPERATOR").length,
    supervisors: users.filter((u) => u.role === "SUPERVISOR").length,
    admins: users.filter((u) => u.role === "ADMIN").length,
    inactive: users.filter((u) => u.status === "DISABLED").length,
  };

  return (
    <div className="space-y-6">
      <RealtimeRefresh />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            Operatori e accessi
          </h1>
          <p className="text-sm text-muted-foreground">
            Crea, modifica e disabilita gli account che possono accedere al tool.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/users/new">
            <Plus className="h-4 w-4" /> Nuovo utente
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Operatori" value={totals.operators} />
        <Kpi label="Supervisor" value={totals.supervisors} />
        <Kpi label="Admin" value={totals.admins} />
        <Kpi label="Disattivi" value={totals.inactive} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Account ({users.length})</CardTitle>
          <Badge variant="muted">{users.length}</Badge>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <EmptyState title="Nessun utente." hint="Crea il primo account operatore." />
          ) : (
            <UsersTable rows={users as UserRow[]} currentUserId={currentUserId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
