/**
 * Reports section layout — server-side role gate (SUPERVISOR / ADMIN).
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPERVISOR" && session.user.role !== "ADMIN") redirect("/");
  return <>{children}</>;
}
