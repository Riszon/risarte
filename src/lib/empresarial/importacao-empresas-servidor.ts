import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { empresarialDb } from "./db";
import { DEFAULT_ADHESION_PRICING } from "./pricing";
import type { ContextoDaImportacao, EmpresaParaGravar } from "./planilha-empresas";

// Risarte Empresarial — o que a importação de empresas precisa do BANCO
// (1047). Uma leitura só para o modelo (as listas da setinha ▼) e para a
// conferência (o que já existe), para as duas falarem das mesmas unidades e
// dos mesmos consultores.
//
// ⚠️ AP11 — LEITURA QUE FALHA É RECUSA: sem saber quais documentos já
// existem, a conferência não pode dizer "nenhum existe". Devolve `null` e a
// action recusa a importação inteira.

type Db = Awaited<ReturnType<typeof empresarialDb>>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ListasDaPlanilha = {
  unidades: { id: string; nome: string }[];
  consultores: { id: string; nome: string; email: string | null }[];
};

/** As unidades (franquias ativas) e os consultores RisLife. */
export async function listasDaPlanilhaDeEmpresas(supabase: Supabase): Promise<ListasDaPlanilha | null> {
  const [{ data: clinicas, error: e1 }, { data: consultores, error: e2 }] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, name")
      .eq("type", "franchise_unit")
      .eq("is_active", true)
      .order("name")
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("user_clinic_roles")
      .select("user_id, profiles ( full_name, email )")
      .eq("role", "rislife_consultant")
      .returns<{ user_id: string; profiles: { full_name: string | null; email: string | null } | null }[]>(),
  ]);
  if (e1 || e2) return null;
  const porId = new Map<string, { id: string; nome: string; email: string | null }>();
  for (const c of consultores ?? []) {
    porId.set(c.user_id, {
      id: c.user_id,
      nome: c.profiles?.full_name?.trim() || c.profiles?.email || "—",
      email: c.profiles?.email ?? null,
    });
  }
  return {
    unidades: (clinicas ?? []).map((c) => ({ id: c.id, nome: c.name })),
    consultores: [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  };
}

/** O contexto da conferência: as listas + os documentos já cadastrados. */
export async function contextoDaImportacaoDeEmpresas(
  db: Db,
  supabase: Supabase
): Promise<(ContextoDaImportacao & { precoDaRede: PrecoDaRede }) | null> {
  const [listas, docs, empresas, rede] = await Promise.all([
    listasDaPlanilhaDeEmpresas(supabase),
    db.from("company_documents").select("doc_number").returns<{ doc_number: string }[]>(),
    db.from("companies").select("cnpj").returns<{ cnpj: string }[]>(),
    db
      .from("adhesion_pricing")
      .select("holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents")
      .is("company_id", null)
      .maybeSingle<PrecoDaRede>(),
  ]);
  if (!listas || docs.error || empresas.error || rede.error) return null;
  const documentosExistentes = new Set<string>();
  for (const d of docs.data ?? []) documentosExistentes.add(d.doc_number);
  for (const e of empresas.data ?? []) documentosExistentes.add(e.cnpj.replace(/[^A-Za-z0-9]/g, ""));
  return {
    ...listas,
    documentosExistentes,
    precoDaRede: rede.data ?? {
      holder_fee_cents: DEFAULT_ADHESION_PRICING.holderFeeCents,
      dependent_individual_fee_cents: DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
      dependent_family_fee_cents: DEFAULT_ADHESION_PRICING.dependentFamilyFeeCents,
      dependent_family_extra_fee_cents: DEFAULT_ADHESION_PRICING.dependentFamilyExtraFeeCents,
    },
  };
}

export type PrecoDaRede = {
  holder_fee_cents: number;
  dependent_individual_fee_cents: number;
  dependent_family_fee_cents: number;
  dependent_family_extra_fee_cents: number;
};

/**
 * O preço que a planilha deixou em branco é o da REDE — mas, quando a empresa
 * tem preço próprio, a linha dela substitui a da rede INTEIRA. Por isso o
 * branco é preenchido com o da rede aqui, em vez de ficar nulo.
 */
export function completarPrecos(empresas: EmpresaParaGravar[], rede: PrecoDaRede): EmpresaParaGravar[] {
  return empresas.map((e) =>
    e.precos
      ? {
          ...e,
          precos: {
            holder_fee_cents: e.precos.holder_fee_cents ?? rede.holder_fee_cents,
            dependent_individual_fee_cents: e.precos.dependent_individual_fee_cents ?? rede.dependent_individual_fee_cents,
            dependent_family_fee_cents: e.precos.dependent_family_fee_cents ?? rede.dependent_family_fee_cents,
            dependent_family_extra_fee_cents:
              e.precos.dependent_family_extra_fee_cents ?? rede.dependent_family_extra_fee_cents,
            dependent_mode: e.precos.dependent_mode,
          },
        }
      : e
  );
}
