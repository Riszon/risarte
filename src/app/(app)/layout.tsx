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

  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const reportRoles = [
    "unit_manager",
    "planner_dentist",
    "franchisee",
    "franchisor_staff",
    "commercial_consultant",
  ];
  const canViewReports =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.some((r) => reportRoles.includes(r))
    );

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar
        fullName={session.fullName}
        email={session.email}
        isAdminMaster={session.isAdminMaster}
        isPlanner={isPlanner}
        canViewReports={canViewReports}
        clinics={session.clinics.map(({ id, name, type }) => ({
          id,
          name,
          type,
        }))}
        activeClinicId={session.activeClinic?.id ?? null}
        activeClinicRoles={
          session.activeClinic
            ? (session.rolesByClinic[session.activeClinic.id] ?? [])
            : []
        }
      />
      <main className="flex-1 overflow-x-auto bg-background">{children}</main>
    </div>
  );
}
