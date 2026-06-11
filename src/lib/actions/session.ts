"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_CLINIC_COOKIE, getSessionContext } from "@/lib/auth";

export async function setActiveClinic(clinicId: string) {
  const session = await getSessionContext();
  const allowed = session.clinics.some((c) => c.id === clinicId);
  if (!allowed) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLINIC_COOKIE, clinicId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
