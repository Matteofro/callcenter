"use client";
/**
 * Client table for the admin users list.
 * Inline actions: activate/deactivate, edit, soft-delete.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { Power, Pencil, Trash2 } from "lucide-react";
import type { UserRole, UserStatus } from "@prisma/client";

export type UserRow = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
  _count: { calls: number };
};

const ROLE_LABEL: Record<UserRole, string> = {
  OPERATOR: "Operatore",
  SUPERVISOR: "Supervisor",
  ADMIN: "Admin",
};

const ROLE_VARIANT: Record<UserRole, "outline" | "success" | "muted"> = {
  OPERATOR: "outline",
  SUPERVISOR: "success",
  ADMIN: "success",
};

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function UsersTable({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(row: UserRow) {
    setBusyId(row.id);
    const next: UserStatus = row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const r = await apiFetch(`/api/admin/users/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    setBusyId(null);
    if (!r.ok) return toast.error(r.error.message);
    toast.success(next === "ACTIVE" ? "Utente riattivato." : "Utente disattivato.");
    startTransition(() => router.refresh());
  }

  async function softDelete(row: UserRow) {
    if (!confirm(`Eliminare definitivamente l'account di ${row.fullName}?\nLo storico chiamate rimane.`)) return;
    setBusyId(row.id);
    const r = await apiFetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!r.ok) return toast.error(r.error.message);
    toast.success("Utente eliminato.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 text-left font-medium">Nome</th>
            <th className="py-2 pr-3 text-left font-medium">Email</th>
            <th className="py-2 pr-3 text-left font-medium">Ruolo</th>
            <th className="py-2 pr-3 text-right font-medium hidden md:table-cell">Chiamate</th>
            <th className="py-2 pr-3 text-left font-medium hidden lg:table-cell">Ultimo login</th>
            <th className="py-2 pr-3 text-center font-medium">Stato</th>
            <th className="py-2 text-right font-medium">Azioni</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelf = r.id === currentUserId;
            return (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="py-2.5 pr-3 font-medium">
                  {r.fullName}
                  {isSelf && <span className="ml-2 text-xs text-muted-foreground">(tu)</span>}
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">{r.email}</td>
                <td className="py-2.5 pr-3">
                  <Badge variant={ROLE_VARIANT[r.role]}>{ROLE_LABEL[r.role]}</Badge>
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums hidden md:table-cell">{r._count.calls}</td>
                <td className="py-2.5 pr-3 text-muted-foreground hidden lg:table-cell">
                  {formatDate(r.lastLoginAt)}
                </td>
                <td className="py-2.5 pr-3 text-center">
                  {r.status === "ACTIVE" ? (
                    <Badge variant="success">Attivo</Badge>
                  ) : (
                    <Badge variant="muted">Disattivo</Badge>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleActive(r)}
                      disabled={isPending || isSelf || busyId === r.id}
                      title={isSelf ? "Non puoi disattivare te stesso" : r.status === "ACTIVE" ? "Disattiva" : "Riattiva"}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/admin/users/${r.id}`} title="Modifica">
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => softDelete(r)}
                      disabled={isPending || isSelf || busyId === r.id}
                      title={isSelf ? "Non puoi eliminare te stesso" : "Elimina"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
