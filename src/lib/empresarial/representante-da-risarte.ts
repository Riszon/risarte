import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import type { Contratada, Genero } from "./contrato";

/**
 * QUEM REPRESENTA A RISARTE NO CONTRATO DE ADESÃO (AP95, decisão do dono,
 * 03/11/2026): o Consultor RisLife responsável pela empresa (ou pelo lead).
 * Sem consultor responsável, quem envia — e fica registrado (`sent_by`).
 *
 * O texto do contrato cita o representante com nome, CPF, RG, cargo e
 * nacionalidade. Esses dados vêm da FICHA DO RISARTANO dele (0356: RG e
 * nacionalidade); Configurações → Contrato segue dando a razão social, o CNPJ,
 * o endereço e a cidade da Risarte.
 *
 * A pessoa que o texto cita e a que assina são a MESMA conta: a janela de envio
 * oferece só ela (`candidatosDaRisarte`).
 */

export type RepresentanteDaRisarte = {
  userId: string;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  nacionalidade: string | null;
  cargo: string | null;
  genero: Genero | null;
};

type Ficha = {
  full_name: string | null;
  cpf: string | null;
  role_title: string | null;
  gender: string | null;
  rg?: string | null;
  nationality?: string | null;
};

function generoDaFicha(g: string | null): Genero | null {
  return g === "female" ? "F" : g === "male" ? "M" : null;
}

/**
 * Lê a ficha. A ficha é lida pela chave de serviço: quem envia precisa do RG
 * de quem assina, e a regra de leitura da equipe não é a deste documento.
 * `semColuna` = o banco ainda não tem a 0356 (o contrato avisa e cai no que
 * está em Configurações → Contrato).
 */
export async function lerRepresentanteDaRisarte(
  userId: string
): Promise<{ ok: true; rep: RepresentanteDaRisarte } | { ok: false; semColuna: boolean }> {
  const admin = createAdminClient();
  const [{ data: ficha, error }, { data: perfil }] = await Promise.all([
    admin
      .from("staff_members")
      .select("full_name, cpf, role_title, gender, rg, nationality")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle<Ficha>(),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle<{ full_name: string | null }>(),
  ]);
  if (error) {
    console.error("representante da Risarte:", error.message);
    return { ok: false, semColuna: /rg|nationality/.test(error.message) };
  }
  return {
    ok: true,
    rep: {
      userId,
      nome: ficha?.full_name?.trim() || perfil?.full_name?.trim() || null,
      cpf: ficha?.cpf ?? null,
      rg: ficha?.rg ?? null,
      nacionalidade: ficha?.nationality ?? null,
      // `role_title` guarda a função (o código); no contrato vai o nome dela.
      cargo: ficha?.role_title ? (ROLE_LABELS[ficha.role_title as UserRole] ?? ficha.role_title) : null,
      genero: generoDaFicha(ficha?.gender ?? null),
    },
  };
}

/** Configurações → Contrato com o representante trocado pelo da ficha. */
export function comRepresentante(contratada: Contratada | null, rep: RepresentanteDaRisarte): Contratada {
  const onde = `ficha do Risartano ${rep.nome ?? "de quem assina"}`;
  return {
    legalName: contratada?.legalName ?? null,
    cnpj: contratada?.cnpj ?? null,
    address: contratada?.address ?? null,
    signingCity: contratada?.signingCity ?? null,
    repName: rep.nome,
    repRole: rep.cargo,
    repNationality: rep.nacionalidade,
    repRg: rep.rg,
    repCpf: rep.cpf,
    repGender: rep.genero,
    repOrigem: onde,
  };
}
