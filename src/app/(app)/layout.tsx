import { AppShell } from "@/components/layout/app-shell";
import { requireAuth } from "@/server/auth/session";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await requireAuth();
  return <AppShell user={user}>{children}</AppShell>;
}
