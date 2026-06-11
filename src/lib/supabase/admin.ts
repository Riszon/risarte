import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Server-side ONLY, and exclusively
 * inside actions that already verified the caller is Admin Master.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (never NEXT_PUBLIC_).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SERVICE_ROLE_KEY_MISSING");
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isAdminClientConfigured() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
