"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Home, PhoneCall, Truck, BarChart3, Users, Settings, FileBarChart, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If set, only roles in the list see this entry */
  roles?: Array<"OPERATOR" | "SUPERVISOR" | "ADMIN">;
};

const items: Item[] = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/queue", label: "Coda chiamate", icon: PhoneCall },
  { href: "/issues", label: "Problemi spedizione", icon: Truck },
  { href: "/kpi", label: "KPI", icon: BarChart3 },
  { href: "/supervisor", label: "Supervisore", icon: Users, roles: ["SUPERVISOR", "ADMIN"] },
  { href: "/reports", label: "Report", icon: FileBarChart, roles: ["SUPERVISOR", "ADMIN"] },
  { href: "/admin/upsell", label: "Admin Upsell", icon: Settings, roles: ["ADMIN"] },
  { href: "/admin/users", label: "Operatori", icon: UserCog, roles: ["ADMIN"] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data } = useSession();
  const role = data?.user.role;

  return (
    <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:bg-card">
      <div className="flex h-16 items-center px-6 border-b">
        <span className="font-semibold tracking-tight">Call Center</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items
          .filter((it) => !it.roles || (role && it.roles.includes(role)))
          .map((it) => {
            const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium tap-44",
                  active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">v0.1 · MVP</div>
    </aside>
  );
}
