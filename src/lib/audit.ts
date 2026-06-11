import { createClient } from "@/lib/supabase/server";

type AuditEntry = {
  action: "view" | "create" | "update" | "anonymize" | "export";
  entityType: string;
  entityId?: string;
  clinicId?: string;
  details?: Record<string, unknown>;
};

/**
 * LGPD audit trail. Never include personal/health data in `details` —
 * only ids and non-sensitive metadata.
 */
export async function logAudit(entry: AuditEntry) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from("audit_logs").insert({
    user_id: user.id,
    clinic_id: entry.clinicId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    details: entry.details ?? null,
  });

  if (error) {
    // Never break the user flow because of audit logging, but make it
    // visible in server logs (no patient data here, only ids).
    console.error("audit_logs insert failed:", error.message);
  }
}
