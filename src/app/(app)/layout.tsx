import { cookies } from "next/headers";
import { getSessionContext, pode } from "@/lib/auth";
import { canViewEmpresarial } from "@/lib/empresarial/access";
import { canViewFinance } from "@/lib/finance/access";
import { canViewStock } from "@/lib/stock-access";
import { canViewPurchases } from "@/lib/purchases-access";
import { canViewPpr } from "@/lib/ppr/access";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { AppSidebar } from "@/components/app-sidebar";
import { ChooseClinicWelcome } from "@/components/choose-clinic-welcome";
import { UrgentSchedulingPopup } from "@/components/urgent-scheduling-popup";
import { TreatmentStartPopup } from "@/components/treatment-start-popup";
import { AccessibilityGuard } from "@/components/accessibility-guard";

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

  // ⚠️ QUEM VÊ O QUÊ VEM DA MATRIZ DE PERMISSÕES (migração 0246), editável pelo
  // Admin Master em `/admin/permissoes`. As listas de papéis que ficavam aqui
  // viraram a SEMENTE da tabela (`src/lib/permissions.ts`).
  //
  // Relatórios e Planos perguntam pela CLÍNICA ATIVA; os demais perguntam por
  // qualquer clínica. Essa diferença é de propósito e vem de antes da matriz: o
  // consultor comercial vive na Franqueadora e atende as unidades, então exigir
  // o papel na unidade ativa o deixaria sem o Comercial.
  const clinicaAtiva = session.activeClinic?.id ?? null;
  const canViewReports = pode(session, "modulo.relatorios", clinicaAtiva);
  const canViewPlans = pode(session, "modulo.planos", clinicaAtiva);
  const canViewStaff = pode(session, "modulo.risartanos");
  const canViewComercial = pode(session, "modulo.comercial");

  // Módulo Risarte Empresarial (B2B).
  const canViewEmp = canViewEmpresarial(session);
  // FIN0: módulo Financeiro — gestão da unidade + Financeiro da Franqueadora.
  const canSeeFinance = canViewFinance(session);
  // 0213: Estoque — gestão + quem atende. Fora do Financeiro de propósito:
  // dentista e TSB precisam da tela e não podem ver financeiro.
  const canSeeStock = canViewStock(session, session.activeClinic?.id ?? null);
  // C1: Compras — gerente monta a lista, franqueadora recebe. Fora do
  // Financeiro: quem sabe o que falta é quem mexe na prateleira.
  const canSeePurchases = canViewPurchases(
    session,
    session.activeClinic?.id ?? null
  );

  // PPR2: seção do Programa de Prevenção Riso+ (toda a operação enxerga).
  const canSeePpr = canViewPpr(session);

  // Estado da sidebar (minimizada?) vem do cookie para não "piscar" no load.
  const cookieStore = await cookies();
  const sidebarCollapsed =
    cookieStore.get("risarte_sidebar_collapsed")?.value === "1";

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar
        fullName={session.fullName}
        email={session.email}
        isAdminMaster={session.isAdminMaster}
        navPermitido={[
          "menu.jornada",
          "menu.agenda",
          "menu.atendimento",
          "menu.prontuarios",
          "menu.planejamento",
          "menu.procedimentos",
          // 0247: o manual e o diário do sistema, para toda a operação.
          "menu.manual",
          "menu.sistema",
        ].filter((c) => pode(session, c, clinicaAtiva))}
        isPlanner={isPlanner}
        canViewReports={canViewReports}
        canViewPlans={canViewPlans}
        canViewComercial={canViewComercial}
        canViewStaff={canViewStaff}
        canViewEmpresarial={canViewEmp}
        canViewFinance={canSeeFinance}
        canViewStock={canSeeStock}
        canViewPurchases={canSeePurchases}
        canViewPpr={canSeePpr}
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
        initialCollapsed={sidebarCollapsed}
      />
      {/* overflow-x-auto força overflow-y:auto → o <main> é quem rola na
          vertical; scrollbar-gutter:stable reserva o espaço da barra para o
          conteúdo não "pular" na horizontal ao trocar de aba/tela. */}
      <main className="flex-1 overflow-x-auto bg-background [scrollbar-gutter:stable]">
        {children}
      </main>
      {/* AJ4: pop-up da recepção para pedidos de agendamento de apresentação. */}
      <UrgentSchedulingPopup />
      {/* COM4: pop-up forte da recepção quando uma venda é fechada. */}
      <TreatmentStartPopup />
      {/* Contorno: garante que a tela não fique invisível para leitor de tela
          depois que os avisos acima fecham. Ver o comentário do componente. */}
      <AccessibilityGuard />
    </div>
  );
}
