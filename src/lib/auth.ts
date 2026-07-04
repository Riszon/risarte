import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ClinicType, UserRole } from "@/lib/roles";

export const ACTIVE_CLINIC_COOKIE = "risarte_active_clinic";

export type Clinic = {
  id: string;
  name: string;
  type: ClinicType;
  is_active: boolean;
};

export type SessionContext = {
  userId: string;
  email: string;
  fullName: string;
  isAdminMaster: boolean;
  /** Clinics the user can work in (all clinics for Admin Master) */
  clinics: Clinic[];
  /** Roles per clinic id */
  rolesByClinic: Record<string, UserRole[]>;
  activeClinic: Clinic | null;
  /** True when the active clinic came from an explicit choice (cookie), not a
   * fallback default — drives the "choose your unit" welcome screen (H1.7). */
  activeClinicExplicit: boolean;
};

type RoleRow = {
  role: UserRole;
  clinics: Clinic | null;
};

/**
 * Loads the logged-in user, their clinics/roles and the active clinic
 * (chosen via cookie). Redirects to /login when not authenticated.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, is_admin_master, is_active")
      .eq("id", user.id)
      .single(),
    supabase
      .from("user_clinic_roles")
      .select("role, clinics ( id, name, type, is_active )")
      .eq("user_id", user.id)
      .returns<RoleRow[]>(),
  ]);

  const isAdminMaster = profile?.is_admin_master ?? false;

  const rolesByClinic: Record<string, UserRole[]> = {};
  const memberClinics = new Map<string, Clinic>();
  for (const row of roleRows ?? []) {
    if (!row.clinics) continue;
    memberClinics.set(row.clinics.id, row.clinics);
    (rolesByClinic[row.clinics.id] ??= []).push(row.role);
  }

  let clinics: Clinic[];
  if (isAdminMaster) {
    const { data: allClinics } = await supabase
      .from("clinics")
      .select("id, name, type, is_active")
      .order("type")
      .order("name")
      .returns<Clinic[]>();
    clinics = allClinics ?? [];
  } else {
    clinics = [...memberClinics.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  const cookieStore = await cookies();
  const requestedClinicId = cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value;
  const chosen = clinics.find((c) => c.id === requestedClinicId) ?? null;
  // Franqueadora users enter the franchisor environment directly (owner rule);
  // otherwise fall back to the first clinic (the welcome screen handles the
  // "choose your unit" case for regular multi-unit users — H1.7).
  const franchisor = clinics.find((c) => c.type === "franchisor") ?? null;
  const activeClinic = chosen ?? franchisor ?? clinics[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name || (user.email ?? ""),
    isAdminMaster,
    clinics,
    rolesByClinic,
    activeClinic,
    activeClinicExplicit: chosen !== null,
  };
}

/** Guard for Admin Master-only pages and server actions. */
export async function requireAdminMaster(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    redirect("/");
  }
  return session;
}

export function hasRoleInClinic(
  session: SessionContext,
  clinicId: string | null | undefined,
  roles: UserRole[]
): boolean {
  if (session.isAdminMaster) return true;
  if (!clinicId) return false;
  const clinicRoles = session.rolesByClinic[clinicId] ?? [];
  return roles.some((role) => clinicRoles.includes(role));
}

/**
 * Clinic ids the user has broad access to: direct roles + the franchisor
 * unit scope (Todas/específicas). Mirrors the DB helper used by RLS.
 */
export async function fullAccessClinicIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("user_full_access_clinic_ids");
  return ((data as { clinic_id?: string }[] | string[] | null) ?? [])
    .map((x) => (typeof x === "string" ? x : (x.clinic_id ?? "")))
    .filter(Boolean);
}

/**
 * Like hasRoleInClinic, but franchisor-based roles (Consultor Comercial,
 * Planner etc.) reach the unit through their unit scope — their role row
 * lives at the FRANCHISOR clinic, never at the client's unit.
 */
export async function hasRoleWithScopeForClinic(
  session: SessionContext,
  clinicId: string | null | undefined,
  roles: UserRole[]
): Promise<boolean> {
  if (hasRoleInClinic(session, clinicId, roles)) return true;
  if (!clinicId) return false;
  const holdsAtFranchisor = session.clinics.some(
    (c) =>
      c.type === "franchisor" &&
      (session.rolesByClinic[c.id] ?? []).some((r) => roles.includes(r))
  );
  if (!holdsAtFranchisor) return false;
  return (await fullAccessClinicIds()).includes(clinicId);
}
