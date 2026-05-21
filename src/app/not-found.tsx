import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Pagina non trovata</h1>
      <p className="text-muted-foreground">La risorsa che cerchi non esiste o è stata rimossa.</p>
      <Button asChild>
        <Link href="/">Torna alla dashboard</Link>
      </Button>
    </div>
  );
}
