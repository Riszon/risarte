import { getSessionContext } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const session = await getSessionContext();

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar
        fullName={session.fullName}
        email={session.email}
        isAdminMaster={session.isAdminMaster}
        clinics={session.clinics.map(({ id, name, type }) => ({
          id,
          name,
          type,
        }))}
        activeClinicId={session.activeClinic?.id ?? null}
      />
      <main className="flex-1 overflow-x-auto bg-background">{children}</main>
    </div>
  );
}
