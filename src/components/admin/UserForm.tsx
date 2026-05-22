"use client";
/**
 * Create / edit form for a User account.
 *
 * Same form used in /admin/users/new and /admin/users/[id].
 * In edit mode the password field is optional (omit to keep the current one).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/client/api";
import type { UserRole, UserStatus } from "@prisma/client";
import { Save, RotateCcw } from "lucide-react";

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: "OPERATOR", label: "Operatore", hint: "Gestisce chiamate e ordini" },
  { value: "SUPERVISOR", label: "Supervisor", hint: "Vede dashboard team + export CSV" },
  { value: "ADMIN", label: "Admin", hint: "Accesso completo: utenti + regole upsell" },
];

export interface UserFormProps {
  mode: "create" | "edit";
  initial?: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    status: UserStatus;
  };
}

function generatePassword(): string {
  // 14 chars: 1 upper + 1 lower + 1 digit guaranteed
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  for (let i = 0; i < 11; i++) chars.push(pick(all));
  return chars.sort(() => Math.random() - 0.5).join("");
}

export function UserForm({ mode, initial }: UserFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState(initial?.email ?? "");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [role, setRole] = useState<UserRole>(initial?.role ?? "OPERATOR");
  const [status, setStatus] = useState<UserStatus>(initial?.status ?? "ACTIVE");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const base = { fullName: fullName.trim(), role, status };
    const body: Record<string, unknown> =
      mode === "create"
        ? { ...base, email: email.trim().toLowerCase(), password }
        : { ...base, ...(password ? { password } : {}) };

    const r =
      mode === "create"
        ? await apiFetch("/api/admin/users", {
            method: "POST",
            body: JSON.stringify(body),
          })
        : await apiFetch(`/api/admin/users/${initial!.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });

    setSaving(false);
    if (!r.ok) return toast.error(r.error.message);

    toast.success(
      mode === "create"
        ? `Utente creato. Password temporanea: ${password}\nCopiala e inviala all'operatore.`
        : password
          ? "Utente aggiornato. Nuova password impostata."
          : "Utente aggiornato.",
      { duration: 12_000 },
    );

    startTransition(() => {
      router.push("/admin/users");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "Nuovo utente" : "Modifica utente"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="mario.rossi@example.com"
                required
                disabled={mode === "edit"}
              />
              {mode === "edit" && (
                <p className="text-xs text-muted-foreground">
                  L'email non è modificabile dopo la creazione.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Nome e cognome</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Mario Rossi"
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ruolo</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ROLES.find((r) => r.value === role)?.hint}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Stato</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as UserStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Attivo (può accedere)</SelectItem>
                  <SelectItem value="INACTIVE">Disattivo (login bloccato)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">
              {mode === "create" ? "Password (min 10 caratteri, A-z 0-9)" : "Nuova password (lascia vuoto per non cambiarla)"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "create" ? "Inserisci una password o generala" : "•••••••• invariata"}
                required={mode === "create"}
                minLength={10}
                autoComplete="new-password"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
                <RotateCcw className="h-4 w-4" /> Genera
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Mostrata in chiaro perché tu possa inviarla all'operatore. Lui dovrebbe cambiarla al primo accesso.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="submit" disabled={saving || isPending}>
              <Save className="h-4 w-4" /> Salva
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/admin/users")}
              disabled={saving || isPending}
            >
              Annulla
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
