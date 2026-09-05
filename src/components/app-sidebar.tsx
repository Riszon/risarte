"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  CalendarRange,
  ChevronsLeft,
  ChevronsRight,
  BadgePercent,
  BookMarked,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DoorOpen,
  LifeBuoy,
  FileText,
  Handshake,
  HeartPulse,
  Home,
  Boxes,
  Landmark,
  ShoppingCart,
  LogOut,
  MessagesSquare,
  Route,
  ScrollText,
  Stethoscope,
  Tags,
  Users,
  ShieldCheck,
  UserCog,
  Contact,
  ChevronsUpDown,
  type LucideIcon,
} from "lucide-react";
import { SystemClock } from "@/components/clock";
import { NotificationNavItem } from "@/components/notification-nav-item";
import { ChatNavItem } from "@/components/chat-nav-item";
import { RisarteMark } from "@/components/risarte-logo";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setActiveClinic } from "@/lib/actions/session";
import { cn } from "@/lib/utils";
import {
  APP_VERSION,
  LATEST_MIGRATION,
  EMPRESARIAL_VERSION,
  EMPRESARIAL_MIGRATION,
} from "@/lib/version";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CLINIC_TYPE_LABELS,
  ROLE_LABELS,
  type ClinicType,
  type UserRole,
} from "@/lib/roles";

type SidebarClinic = { id: string; name: string; type: ClinicType };

type Props = {
  fullName: string;
  email: string;
  isAdminMaster: boolean;
  /** As capacidades de menu que esta pessoa tem, pela matriz (0246). */
  navPermitido: string[];
  /** The user holds the Dentista Planner role somewhere (Centro de Planejamento). */
  /**
   * Mantido na assinatura porque o layout ainda o calcula e outras telas o
   * usam. O menu deixou de decidir por ele: "Centro de Planejamento" e
   * "Procedimentos" agora vêm da matriz de permissões (0246), cada um com a
   * sua capacidade — e assim podem ser concedidos separadamente.
   */
  isPlanner?: boolean;
  /** Management/network roles can see the consolidated Relatórios screen. */
  canViewReports: boolean;
  /** H4.4: gestão/planner podem ver a central de Planos de Tratamento. */
  canViewPlans: boolean;
  /** COM2: time comercial vê o acesso rápido /comercial (kanban no COM3). */
  canViewComercial: boolean;
  /** H4.1: gestão/rede podem ver o cadastro de Risartanos (colaboradores). */
  canViewStaff: boolean;
  /** Módulo Risarte Empresarial (B2B). */
  canViewEmpresarial: boolean;
  /** PPR2: seção do Programa de Prevenção Riso+ (PPR+). */
  canViewPpr: boolean;
  /** FIN0: módulo Financeiro (gestão + Financeiro da Franqueadora). */
  canViewFinance: boolean;
  /** 0213: Estoque — gestão da unidade + quem atende (consumo avulso). */
  canViewStock: boolean;
  /** C1: Compras — a lista da unidade e a mesa da franqueadora. */
  canViewPurchases: boolean;
  clinics: SidebarClinic[];
  activeClinicId: string | null;
  /** Roles the user holds at the ACTIVE clinic (confusion-proofing). */
  activeClinicRoles: UserRole[];
  /** Sidebar minimizada? Vem do cookie (server) para não "piscar" ao carregar. */
  initialCollapsed: boolean;
};

// `cap` liga o item à MATRIZ DE PERMISSÕES (0246): o servidor manda em
// `navPermitido` quais dessas capacidades a pessoa tem, e o item some quando
// não tem. Itens sem `cap` são decididos pelas condições próprias abaixo
// (Comercial, Financeiro, Estoque…), que já consultam a matriz do lado do
// servidor. "Início" não tem capacidade — é a porta de entrada de todo mundo.
type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  cap?: string | null;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Início", icon: Home, cap: null },
  { href: "/jornada", label: "Jornada", icon: Route, cap: "menu.jornada" },
  { href: "/agenda", label: "Agenda", icon: Calendar, cap: "menu.agenda" },
  { href: "/atendimento", label: "Atendimento", icon: DoorOpen, cap: "menu.atendimento" },
  { href: "/prontuarios", label: "Prontuários", icon: Users, cap: "menu.prontuarios" },
];

// H4.6 B1: painel do dia do Dentista (executor).
const MEU_DIA_ITEM = { href: "/meu-dia", label: "Meu Dia", icon: Stethoscope };
// H4.6 E3: agenda consolidada de todas as unidades do dentista.
const MINHA_AGENDA_ITEM = {
  href: "/minha-agenda",
  label: "Minha Agenda",
  icon: CalendarRange,
};

// Shown to the Dentista Planner and Admin Master (alongside the unit nav).
const PLANNER_ITEMS: (NavItem & { cap: string })[] = [
  {
    href: "/planejamento",
    label: "Centro de Planejamento",
    icon: ClipboardList,
    cap: "menu.planejamento",
  },
  { href: "/procedimentos", label: "Procedimentos", icon: Tags, cap: "menu.procedimentos" },
];

// H4.4: central dos planos de tratamento (gestão + planner + comercial).
const PLANS_ITEM = {
  href: "/planos",
  label: "Planos de Tratamento",
  icon: ClipboardCheck,
};

// COM2: acesso rápido do time comercial — lista da Fase 4 → cockpit em
// 1 clique (no COM3 esta tela vira o kanban completo com follow-up).
const COMERCIAL_ITEM = {
  href: "/comercial",
  label: "Comercial",
  icon: Handshake,
};

const REPORTS_ITEM = { href: "/relatorios", label: "Relatórios", icon: BarChart3 };

// H4.1: cadastro de colaboradores (RH) — Admin, Gerente e Franqueadora.
const RISARTANOS_ITEM = { href: "/risartanos", label: "Risartanos", icon: Contact };

// Módulo Risarte Empresarial (B2B) — empresas parceiras.
const EMPRESARIAL_ITEM = {
  href: "/empresarial",
  label: "Empresarial",
  icon: Briefcase,
};

// PPR2: Programa de Prevenção Riso+ (PPR+) — prevenção e recorrência.
const PPR_ITEM = {
  href: "/ppr",
  label: "PPR+ (Prevenção)",
  icon: HeartPulse,
};

// FIN0: Financeiro — Admin Master, Financeiro da Franqueadora, Gerente e
// Franqueado (estes dois só enxergam a própria unidade, garantido pela RLS).
const FINANCE_ITEM = {
  href: "/financeiro",
  label: "Financeiro",
  icon: Landmark,
};

// 0213: Estoque — gestão da unidade lança entrada e inventário; quem atende
// registra o consumo avulso. Fica FORA do Financeiro de propósito: dentista e
// TSB precisam desta tela e não podem ver financeiro.
const STOCK_ITEM = {
  href: "/estoque",
  label: "Estoque",
  icon: Boxes,
};

// C1: Compras — a lista nasce do Estoque e vai para a mesa da Franqueadora.
// Fica ao lado dele por isso, e fora do Financeiro: quem monta a lista é o
// gerente, que nem sempre mexe em dinheiro.
const PURCHASES_ITEM = {
  href: "/compras",
  label: "Compras",
  icon: ShoppingCart,
};

// AJUDA — o manual e o diário do sistema. Ficam por último, acima do rodapé:
// não são trabalho do dia, são o que se procura quando algo não está claro ou
// não funcionou. Os dois vêm da matriz (0247), como o resto do menu.
const AJUDA_ITEMS: (NavItem & { cap: string })[] = [
  { href: "/manual", label: "Manual", icon: BookMarked, cap: "menu.manual" },
  { href: "/sistema", label: "Sistema", icon: LifeBuoy, cap: "menu.sistema" },
];

const ADMIN_ITEMS = [
  { href: "/admin/clinicas", label: "Clínicas", icon: Building2 },
  // /admin/usuarios cuida do ACESSO (login); o cadastro de colaborador é /risartanos.
  { href: "/admin/usuarios", label: "Usuários (acesso)", icon: UserCog },
  { href: "/admin/permissoes", label: "Permissões", icon: ShieldCheck },
  { href: "/admin/sla", label: "Prazos (SLA)", icon: Clock },
  { href: "/admin/regras-comerciais", label: "Regras Comerciais", icon: BadgePercent },
  { href: "/admin/agenda", label: "Config. Agenda", icon: CalendarClock },
  { href: "/admin/anamnese", label: "Fichas de Anamnese", icon: ClipboardList },
  { href: "/admin/orientacoes", label: "Orientações", icon: BookOpen },
  { href: "/admin/documentos", label: "Modelos de Documentos", icon: FileText },
  { href: "/admin/chat", label: "Chat (contatos)", icon: MessagesSquare },
  { href: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
];

export function AppSidebar({
  fullName,
  email,
  isAdminMaster,
  navPermitido,
  canViewReports,
  canViewPlans,
  canViewComercial,
  canViewStaff,
  canViewEmpresarial,
  canViewPpr,
  canViewFinance,
  canViewStock,
  canViewPurchases,
  clinics,
  activeClinicId,
  activeClinicRoles,
  initialCollapsed,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const activeClinic = clinics.find((c) => c.id === activeClinicId) ?? null;
  const initials =
    fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      document.cookie = `risarte_sidebar_collapsed=${next ? "1" : "0"};path=/;max-age=31536000`;
      return next;
    });
  }

  // The Dentista (executor) does not have the Jornada screen (owner rule).
  const dentistOnly =
    !isAdminMaster &&
    activeClinicRoles.length > 0 &&
    activeClinicRoles.every((r) => r === "dentist");
  // A MATRIZ DE PERMISSÕES (0246) decide os itens básicos. `dentistOnly`
  // continua tirando a Jornada de quem só é dentista — é regra de tela, não de
  // permissão: o dentista tem "Meu Dia" no lugar.
  let navItems = NAV_ITEMS.filter(
    (item) =>
      (!item.cap || navPermitido.includes(item.cap)) &&
      !(dentistOnly && item.href === "/jornada")
  );
  // H4.6 B1/E3: "Meu Dia" e "Minha Agenda" logo após Início para o dentista.
  if (activeClinicRoles.includes("dentist")) {
    navItems = [navItems[0], MEU_DIA_ITEM, MINHA_AGENDA_ITEM, ...navItems.slice(1)];
  }
  if (!dentistOnly && canViewComercial) {
    navItems = [...navItems, COMERCIAL_ITEM];
  }
  if (!dentistOnly && canViewPlans) {
    navItems = [...navItems, PLANS_ITEM];
  }
  // Centro de Planejamento e Procedimentos: cada um com a sua capacidade, para
  // poderem ser concedidos separadamente (antes vinham colados).
  if (!dentistOnly) {
    navItems = [
      ...navItems,
      ...PLANNER_ITEMS.filter((i) => navPermitido.includes(i.cap)),
    ];
  }
  if (!dentistOnly && canViewReports) {
    navItems = [...navItems, REPORTS_ITEM];
  }
  if (!dentistOnly && canViewStaff) {
    navItems = [...navItems, RISARTANOS_ITEM];
  }
  if (!dentistOnly && canViewEmpresarial) {
    navItems = [...navItems, EMPRESARIAL_ITEM];
  }
  if (canViewPpr) {
    navItems = [...navItems, PPR_ITEM];
  }
  if (canViewStock) {
    navItems = [...navItems, STOCK_ITEM];
  }
  if (canViewPurchases) {
    navItems = [...navItems, PURCHASES_ITEM];
  }
  if (!dentistOnly && canViewFinance) {
    navItems = [...navItems, FINANCE_ITEM];
  }

  // Manual e Sistema, no bloco "Ajuda". O dentista também os enxerga: ele é
  // quem mais precisa saber o que mudou, e é o único papel cujo menu é
  // diferente de todos os outros.
  const itensDeAjuda = AJUDA_ITEMS.filter((i) => navPermitido.includes(i.cap));

  function switchClinic(clinicId: string) {
    if (clinicId === activeClinicId) return;
    startTransition(async () => {
      await setActiveClinic(clinicId);
      // H1.7: trocar de unidade fecha a tela da unidade anterior (ex.: uma
      // ficha de cliente da unidade A não pode continuar aberta na B).
      router.push("/");
      router.refresh();
    });
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  const linkClass = (href: string) =>
    cn(
      "relative flex items-center rounded-md text-sm transition-colors",
      collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
      isActive(href)
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_2px_0_0_var(--gold)]"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 px-2 py-4">
          <RisarteMark className="h-7 text-gold" />
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Expandir menu"
            aria-label="Expandir menu"
            className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ChevronsRight className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-5">
          <RisarteMark className="h-8 shrink-0 text-gold" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-base font-semibold tracking-tight">Risarte</p>
            <p className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
              Odontologia
            </p>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Minimizar menu"
            aria-label="Minimizar menu"
            className="rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
      )}

      {clinics.length > 0 && !collapsed && (
        <div className="px-3 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  disabled={isPending}
                  className="w-full justify-between border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <span className="truncate text-left">
                    {activeClinic ? activeClinic.name : "Escolher clínica"}
                  </span>
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-60" />
                </Button>
              }
            />
            <DropdownMenuContent className="w-56" align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Trabalhar na clínica</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {clinics.map((clinic) => (
                  <DropdownMenuItem
                    key={clinic.id}
                    onClick={() => switchClinic(clinic.id)}
                    className={cn(
                      clinic.id === activeClinicId && "font-medium bg-accent"
                    )}
                  >
                    <div className="flex flex-col">
                      <span>{clinic.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {CLINIC_TYPE_LABELS[clinic.type]}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* The user's role AT THIS clinic — people with several clinics
              and different roles need this anchor. */}
          <p className="mt-1.5 px-1 text-xs text-sidebar-foreground/70">
            Sua função aqui:{" "}
            <span className="font-medium text-gold">
              {isAdminMaster
                ? "Admin Master"
                : activeClinicRoles.length > 0
                  ? activeClinicRoles.map((r) => ROLE_LABELS[r]).join(", ")
                  : "—"}
            </span>
          </p>
        </div>
      )}

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={linkClass(href)}
            title={collapsed ? label : undefined}
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        ))}
        <ChatNavItem linkClass={linkClass("/chat")} collapsed={collapsed} />
        <NotificationNavItem
          linkClass={linkClass("/notificacoes")}
          collapsed={collapsed}
        />

        {itensDeAjuda.length > 0 && (
          <>
            {collapsed ? (
              <div className="my-2 border-t border-sidebar-border/60" />
            ) : (
              <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                Ajuda
              </p>
            )}
            {itensDeAjuda.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={linkClass(href)}
                title={collapsed ? label : undefined}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            ))}
          </>
        )}

        {isAdminMaster && (
          <>
            {collapsed ? (
              <div className="my-2 border-t border-sidebar-border/60" />
            ) : (
              <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                Administração
              </p>
            )}
            {ADMIN_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={linkClass(href)}
                title={collapsed ? label : undefined}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {/* O relógio fica ACIMA do perfil: é informação de trabalho (que horas
            são para o sistema), não informação de conta. */}
        <div className="mb-2 rounded-md bg-sidebar-accent/40 px-2 py-1.5">
          <SystemClock collapsed={collapsed} />
        </div>
        <Link
          href="/perfil"
          className={cn(
            "mb-2 flex items-center rounded-md hover:bg-sidebar-accent",
            collapsed ? "justify-center p-1.5" : "gap-2.5 px-2 py-1.5"
          )}
          title={collapsed ? `${fullName} — Meu perfil` : "Meu perfil"}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-gold">
            {initials}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">
                {email}
              </p>
            </div>
          )}
        </Link>
        {!collapsed && (
          <p className="mb-2 text-center text-xs text-sidebar-foreground/50">
            Versão {APP_VERSION} · migração {LATEST_MIGRATION}
            <br />
            <span className="opacity-80">
              Empresarial {EMPRESARIAL_VERSION} · migr. {EMPRESARIAL_MIGRATION}
            </span>
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          title="Sair"
          className="w-full justify-center border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className={cn("size-4", !collapsed && "mr-2")} />
          {!collapsed && "Sair"}
        </Button>
      </div>
    </aside>
  );
}
