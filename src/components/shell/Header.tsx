"use client";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ConnectionStatus } from "@/components/shell/ConnectionStatus";

export function Header() {
  const { data } = useSession();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <div className="flex-1 max-w-2xl">
        <GlobalSearch />
      </div>
      <ConnectionStatus />
      <div className="hidden md:flex flex-col items-end text-right">
        <span className="text-sm font-medium leading-tight">{data?.user?.fullName ?? "—"}</span>
        <span className="text-xs text-muted-foreground leading-tight">{data?.user?.email}</span>
      </div>
      <Button variant="ghost" size="icon" aria-label="Esci" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="h-4 w-4" />
      </Button>
    </header>
  );
}
