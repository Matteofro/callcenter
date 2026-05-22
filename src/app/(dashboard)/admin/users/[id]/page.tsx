import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { UserForm } from "@/components/admin/UserForm";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, fullName: true, role: true, status: true, deletedAt: true },
  });
  if (!user || user.deletedAt) notFound();

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Modifica utente</h1>
      <p className="text-sm text-muted-foreground">
        Cambia ruolo, stato o resetta la password. L'email non è modificabile.
      </p>
      <UserForm
        mode="edit"
        initial={{
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          status: user.status,
        }}
      />
    </div>
  );
}
