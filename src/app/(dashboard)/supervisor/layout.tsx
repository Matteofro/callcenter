/**
 * Supervisor section layout — server-side role gate.
 * Any non-SUPERVISOR/ADMIN user is redirected to the home dashboard.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPERVISOR" && session.user.role !== "ADMIN") {
    redirect("/");
  }
  return <>{children}</>;
}
