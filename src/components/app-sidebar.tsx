"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DoorOpen,
  FileText,
  Home,
  LogOut,
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
  /** H4.1: gestão/rede podem ver o cadastro de Risartanos (colaboradores). */
  canViewStaff: boolean;
  /** Módulo Risarte Empresarial (B2B). */
  canViewEmpresarial: boolean;
  clinics: SidebarClinic[];
  activeClinicId: string | null;
  /** Roles the user holds at the ACTIVE clinic (confusion-proofing). */
  activeClinicRoles: UserRole[];
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
  { href: "/admin/agenda", label: "Config. Agenda", icon: CalendarClock },
  { href: "/admin/anamnese", label: "Fichas de Anamnese", icon: ClipboardList },
  { href: "/admin/documentos", label: "Modelos de Documentos", icon: FileText },
  { href: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
];

export function AppSidebar({
  fullName,
  email,
  isAdminMaster,
  isPlanner,
  canViewReports,
  canViewPlans,
  canViewStaff,
  canViewEmpresarial,
  clinics,
  activeClinicId,
  activeClinicRoles,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const activeClinic = clinics.find((c) => c.id === activeClinicId) ?? null;

  // The Dentista (executor) does not have the Jornada screen (owner rule).
  const dentistOnly =
    !isAdminMaster &&
    activeClinicRoles.length > 0 &&
    activeClinicRoles.every((r) => r === "dentist");
  let navItems = dentistOnly
    ? NAV_ITEMS.filter((item) => item.href !== "/jornada")
    : [...NAV_ITEMS];
  // H4.6 B1: "Meu Dia" logo após Início para quem atende como dentista na unidade.
  if (activeClinicRoles.includes("dentist")) {
    navItems = [navItems[0], MEU_DIA_ITEM, ...navItems.slice(1)];
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
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
      isActive(href)
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <p className="text-lg font-semibold tracking-tight">Risarte</p>
        <p className="text-xs text-sidebar-foreground/60">Odontologia</p>
      </div>

      {clinics.length > 0 && (
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
          <Link key={href} href={href} className={linkClass(href)}>
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <NotificationNavItem linkClass={linkClass("/notificacoes")} />

        {isAdminMaster && (
          <>
            <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
              Administração
            </p>
            {ADMIN_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={linkClass(href)}>
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/perfil"
          className="mb-2 block rounded-md px-2 py-1 hover:bg-sidebar-accent"
          title="Meu perfil"
        >
          <p className="truncate text-sm font-medium">{fullName}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{email}</p>
        </Link>
        <p className="mb-2 text-center text-xs text-sidebar-foreground/50">
          Versão {APP_VERSION} · migração {LATEST_MIGRATION}
          <br />
          <span className="opacity-80">
            Empresarial {EMPRESARIAL_VERSION} · migr. {EMPRESARIAL_MIGRATION}
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          className="w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="mr-2 size-4" />
          Sair
        </Button>
      </div>
    </aside>
  );
}
