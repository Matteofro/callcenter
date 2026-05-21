"use client";
/**
 * Global search box. Submitting jumps directly to the first matching customer.
 * Cmd/Ctrl+K focuses the input.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { toast } from "sonner";

type SearchResp = {
  results: Array<{ id: string; fullName: string }>;
};

export function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value.trim().length < 2) return;
    setLoading(true);
    const r = await apiFetch<SearchResp>(
      `/api/customers/search?q=${encodeURIComponent(value.trim())}&limit=1`,
    );
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    if (r.data.results.length === 0) {
      toast.warning("Nessun cliente trovato.");
      return;
    }
    router.push(`/customers/${r.data.results[0]!.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        type="search"
        placeholder="Cerca per telefono, email, nome o ID ordine…   (⌘K)"
        className="pl-9"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={loading}
      />
    </form>
  );
}
