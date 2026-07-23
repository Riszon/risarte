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
  ClipboardCheck,
  ClipboardList,
  Clock,
  DoorOpen,
  FileText,
  Handshake,
  Home,
  LogOut,
  MessagesSquare,
  Route,
  ScrollText,
  Stethoscope,
  Tags,
  Users,
  UserCog,
  Contact,
  ChevronsUpDown,
} from "lucide-react";
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
  /** The user holds the Dentista Planner role somewhere (Centro de Planejamento). */
  isPlanner: boolean;
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
  clinics: SidebarClinic[];
  activeClinicId: string | null;
  /** Roles the user holds at the ACTIVE clinic (confusion-proofing). */
  activeClinicRoles: UserRole[];
  /** Sidebar minimizada? Vem do cookie (server) para não "piscar" ao carregar. */
  initialCollapsed: boolean;
};

const NAV_ITEMS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/jornada", label: "Jornada", icon: Route },
  { href: "/agenda", label: "Agenda", icon: Calendar },
  { href: "/atendimento", label: "Atendimento", icon: DoorOpen },
  { href: "/prontuarios", label: "Prontuários", icon: Users },
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
const PLANNER_ITEMS = [
  { href: "/planejamento", label: "Centro de Planejamento", icon: ClipboardList },
  { href: "/procedimentos", label: "Procedimentos", icon: Tags },
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

const ADMIN_ITEMS = [
  { href: "/admin/clinicas", label: "Clínicas", icon: Building2 },
  // /admin/usuarios cuida do ACESSO (login); o cadastro de colaborador é /risartanos.
  { href: "/admin/usuarios", label: "Usuários (acesso)", icon: UserCog },
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
  isPlanner,
  canViewReports,
  canViewPlans,
  canViewComercial,
  canViewStaff,
  canViewEmpresarial,
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
  let navItems = dentistOnly
    ? NAV_ITEMS.filter((item) => item.href !== "/jornada")
    : [...NAV_ITEMS];
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
  if (!dentistOnly && (isAdminMaster || isPlanner)) {
    navItems = [...navItems, ...PLANNER_ITEMS];
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
