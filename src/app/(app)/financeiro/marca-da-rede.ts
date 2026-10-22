import "server-only";
import { cookies } from "next/headers";
import { MARCA_DA_REDE_COOKIE, lerMarca } from "@/lib/finance/network-areas";

/**
 * OC-00121 — a marca "vim da rede" vale para a unidade que está aberta?
 * Só leitura; quem desenha a faixa é o layout do Financeiro.
 */
export async function marcaDaRedeAtiva(activeClinicId: string | null) {
  if (!activeClinicId) return null;
  const cookieStore = await cookies();
  const marca = lerMarca(cookieStore.get(MARCA_DA_REDE_COOKIE)?.value);
  return marca && marca.clinicId === activeClinicId ? marca : null;
}
