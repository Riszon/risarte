"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_CLINIC_COOKIE, getSessionContext } from "@/lib/auth";
import { isFinanceFranchisor } from "@/lib/finance/access";
import {
  MARCA_DA_REDE_COOKIE as MARCA_COOKIE,
  NETWORK_TABS,
  ORIGENS_DA_REDE,
  destinoNaUnidade,
  escreverMarca,
  lerMarca,
  voltaParaRede,
  type NetworkTab,
  type OrigemDaRede,
} from "@/lib/finance/network-areas";

/**
 * OC-00121, K2 — ABRIR NA UNIDADE E VOLTAR PARA A REDE.
 *
 * Clicar numa unidade troca a unidade de trabalho (o mesmo cookie do seletor
 * "Trabalhar na clínica") e abre o relatório do mesmo assunto e do mesmo
 * período. Uma segunda marca, `risarte_veio_da_rede`, lembra de onde se veio:
 * é ela que faz a faixa "voltar para a rede" aparecer — e só na unidade que
 * foi aberta. Trocar de unidade pelo seletor desfaz a marca sozinho (a unidade
 * deixa de bater).
 *
 * ⚠️ NADA DE PERMISSÃO NOVA. Só entra quem o banco deixa ler a rede (Admin e
 * Financeiro da Franqueadora), e só numa unidade que já está no seletor dele
 * (`session.clinics` — para o Financeiro da Franqueadora, as do escopo, desde
 * o OC-00120). Dentro da unidade, cada tela segue a regra que já tinha.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

type Result = { ok: false; error: string };

export async function abrirNaUnidade(input: {
  clinicId: string;
  aba: NetworkTab;
  de: string;
  ate: string;
  origem: OrigemDaRede;
}): Promise<Result> {
  const session = await getSessionContext();
  if (!session.isAdminMaster && !isFinanceFranchisor(session)) {
    return { ok: false, error: "Só a Franqueadora abre as unidades pela rede." };
  }
  if (!NETWORK_TABS.some((t) => t.key === input.aba)) {
    return { ok: false, error: "Relatório desconhecido." };
  }
  if (!ORIGENS_DA_REDE.includes(input.origem)) {
    return { ok: false, error: "Origem desconhecida." };
  }
  if (!DATA.test(input.de) || !DATA.test(input.ate)) {
    return { ok: false, error: "Período inválido." };
  }
  const unidade = session.clinics.find((c) => c.id === input.clinicId);
  if (!unidade || unidade.type === "franchisor") {
    return { ok: false, error: "Esta unidade não está entre as que você pode abrir." };
  }

  // De qual franqueadora a pessoa saiu: é para ela que o "voltar" leva.
  const rede =
    session.activeClinic?.type === "franchisor"
      ? session.activeClinic
      : session.clinics.find((c) => c.type === "franchisor");
  if (!rede) return { ok: false, error: "Não há uma rede para voltar depois." };

  const cookieStore = await cookies();
  const umAno = 60 * 60 * 24 * 365;
  cookieStore.set(ACTIVE_CLINIC_COOKIE, unidade.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: umAno,
  });
  cookieStore.set(
    MARCA_COOKIE,
    escreverMarca({
      clinicId: unidade.id,
      redeId: rede.id,
      origem: input.origem,
      aba: input.aba,
      de: input.de,
      ate: input.ate,
    }),
    // Um dia: a marca é de uma visita, não uma preferência.
    { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 }
  );
  revalidatePath("/", "layout");
  redirect(destinoNaUnidade(input.aba, input.de, input.ate));
}

export async function voltarParaRede(): Promise<Result> {
  const session = await getSessionContext();
  if (!session.isAdminMaster && !isFinanceFranchisor(session)) {
    return { ok: false, error: "Não há uma rede para voltar." };
  }
  const cookieStore = await cookies();
  const marca = lerMarca(cookieStore.get(MARCA_COOKIE)?.value);
  // A franqueadora de onde se saiu; se ela não estiver mais no seletor, a
  // primeira que estiver.
  const franqueadora =
    session.clinics.find((c) => c.type === "franchisor" && c.id === marca?.redeId) ??
    session.clinics.find((c) => c.type === "franchisor");
  if (!franqueadora) return { ok: false, error: "Não há uma rede para voltar." };

  cookieStore.set(ACTIVE_CLINIC_COOKIE, franqueadora.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  cookieStore.delete(MARCA_COOKIE);
  revalidatePath("/", "layout");
  redirect(
    marca
      ? voltaParaRede(marca.origem, marca.aba, marca.de, marca.ate)
      : "/financeiro/painel-da-rede"
  );
}
