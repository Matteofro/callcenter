import { UserForm } from "@/components/admin/UserForm";

export const dynamic = "force-dynamic";

export default function NewUserPage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nuovo utente</h1>
      <p className="text-sm text-muted-foreground">
        Crea un account per un operatore, supervisor o admin. La password viene mostrata
        una sola volta — copiala e inviala all'operatore.
      </p>
      <UserForm mode="create" />
    </div>
  );
}
