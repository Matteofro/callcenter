/**
 * Dashboard layout — all logged-in pages live under this segment.
 * Mounts a single shared SSE subscription via RealtimeProvider.
 */
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="flex min-h-screen bg-muted/30">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <Header />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
