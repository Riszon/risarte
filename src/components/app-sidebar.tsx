"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  Building2,
  Calendar,
  ClipboardList,
  Clock,
  DoorOpen,
  Home,
  LogOut,
  Route,
  Users,
  UserCog,
  ChevronsUpDown,
} from "lucide-react";
import { NotificationNavItem } from "@/components/notification-nav-item";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setActiveClinic } from "@/lib/actions/session";
import { cn } from "@/lib/utils";
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
  { href: "/clientes", label: "Clientes", icon: Users },
];

const PLANNER_ITEM = {
  href: "/planejamento",
  label: "Centro de Planejamento",
  icon: ClipboardList,
};

const ADMIN_ITEMS = [
  { href: "/admin/clinicas", label: "Clínicas", icon: Building2 },
  { href: "/admin/usuarios", label: "Usuários", icon: UserCog },
  { href: "/admin/sla", label: "Prazos (SLA)", icon: Clock },
];

export function AppSidebar({
  fullName,
  email,
  isAdminMaster,
  isPlanner,
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
  const navItems = dentistOnly
    ? NAV_ITEMS.filter((item) => item.href !== "/jornada")
    : // Planner/Admin also get the Centro de Planejamento (Fase 3) queue.
      isAdminMaster || isPlanner
      ? [...NAV_ITEMS, PLANNER_ITEM]
      : NAV_ITEMS;

  function switchClinic(clinicId: string) {
    startTransition(async () => {
      await setActiveClinic(clinicId);
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
