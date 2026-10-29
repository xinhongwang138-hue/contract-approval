import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getAccessContext } from "@/server/auth/access";
import { getAuth } from "@/server/auth/session";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuth();
  if (!auth) {
    redirect("/login");
  }

  const access = await getAccessContext(auth.user.id);
  return (
    <AppShell user={auth.user} permissions={[...access.permissions]}>
      {children}
    </AppShell>
  );
}
