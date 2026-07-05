import { getSessionContext } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { AppSidebar } from "@/components/app-sidebar";
import { ChooseClinicWelcome } from "@/components/choose-clinic-welcome";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const session = await getSessionContext();

  // H1.7: usuário com acesso a mais de uma unidade (e sem Franqueadora, que
  // entra direto) escolhe a unidade no login antes de ver qualquer tela.
  const hasFranchisor = session.clinics.some((c) => c.type === "franchisor");
  if (
    !session.isAdminMaster &&
    !hasFranchisor &&
    !session.activeClinicExplicit &&
    session.clinics.length > 1
  ) {
    return (
      <ChooseClinicWelcome
        fullName={session.fullName}
        clinics={session.clinics.map(({ id, name, type }) => ({
          id,
          name,
          type,
        }))}
      />
    );
  }

  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  // Relatórios seguem o papel na CLÍNICA ATIVA (mesma regra de /relatorios):
  // na Franqueadora = staff/planner/consultor; na unidade = gerente/franqueado.
  const activeRoles = session.activeClinic
    ? (session.rolesByClinic[session.activeClinic.id] ?? [])
    : [];
  const reportRoles =
    session.activeClinic?.type === "franchisor"
      ? ["franchisor_staff", "planner_dentist", "commercial_consultant"]
      : ["unit_manager", "franchisee"];
  const canViewReports =
    session.isAdminMaster ||
    activeRoles.some((r) => reportRoles.includes(r));

  // H4.4: central de Planos de Tratamento — gestão da unidade (coordenador/
  // gerente/franqueado) e papéis da Franqueadora (planner/staff/consultor).
  const planRoles =
    session.activeClinic?.type === "franchisor"
      ? ["franchisor_staff", "planner_dentist", "commercial_consultant"]
      : ["unit_manager", "clinical_coordinator", "franchisee"];
  const canViewPlans =
    session.isAdminMaster || activeRoles.some((r) => planRoles.includes(r));

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar
        fullName={session.fullName}
        email={session.email}
        isAdminMaster={session.isAdminMaster}
        isPlanner={isPlanner}
        canViewReports={canViewReports}
        canViewPlans={canViewPlans}
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
