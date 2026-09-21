import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { clienteDoTreino } from "@/lib/treino";
import { podeOlharOTreino } from "@/lib/relatos-do-treino";
import {
  montarPainel,
  type PainelDeRelatos,
  type RelatoCru,
  type RespostaCrua,
} from "@/lib/painel-de-relatos";
import type { ModuloDoSistema, SituacaoDeRelato, TipoDeRelato } from "@/lib/system-reports";
import type { SessionContext } from "@/lib/auth";

/**
 * AS LINHAS QUE ALIMENTAM O PAINEL — dos DOIS ambientes (20/09/2026).
 *
 * Antes o painel era uma função do banco (0258). Com o pedido do dono de
 * consolidar sistema + treino, a conta veio para o código
 * (`montarPainel`) e este arquivo passou a ser quem busca as linhas.
 *
 * ⚠️ DUAS COISAS QUE A FUNÇÃO DO BANCO FAZIA E CONTINUAM SENDO FEITAS AQUI,
 * porque sem elas o painel mente ou vaza:
 *
 * 1. **A leitura é por CHAVE DE SERVIÇO, e não pela sessão.** A RLS de
 *    `system_reports` mostra à Franqueadora só os relatos da clínica dela; um
 *    painel da rede montado com a sessão contaria meia rede e diria que é a
 *    rede inteira. O ranking de pessoas também precisa de nomes que a RLS de
 *    `profiles` esconde.
 * 2. **Por isso o ESCOPO é decidido aqui, antes de qualquer consulta**, com a
 *    mesma régua da 0258: Admin Master e Franqueadora = rede; Gerente e
 *    Franqueado = as próprias unidades; o resto não entra. Definer sem guarda
 *    entrega o dado a quem pedir (0227).
 */

export class SemPermissaoNoPainel extends Error {}

type LinhaDeRelato = {
  code: string;
  kind: TipoDeRelato;
  status: SituacaoDeRelato;
  module: string | null;
  clinic_id: string;
  reporter_id: string;
  reporter_role: string | null;
  created_at: string;
  first_response_at: string | null;
  closed_at: string | null;
  reopened_count: number | null;
  clinics: { name: string } | null;
  profiles: { full_name: string; is_admin_master: boolean } | null;
};

const COLUNAS =
  "code, kind, status, module, clinic_id, reporter_id, reporter_role, created_at, first_response_at, closed_at, reopened_count, clinics ( name ), profiles!system_reports_reporter_id_fkey ( full_name, is_admin_master )";

async function lerRelatos(
  db: SupabaseClient,
  ambiente: "sistema" | "treino"
): Promise<{ linhas: LinhaDeRelato[]; ambiente: "sistema" | "treino" }> {
  const { data, error } = await db
    .from("system_reports")
    .select(COLUNAS)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`relatos (${ambiente}): ${error.code ?? ""}`);
  return { linhas: (data ?? []) as unknown as LinhaDeRelato[], ambiente };
}

async function lerRespostas(
  db: SupabaseClient,
  desde: string
): Promise<{ created_at: string; system_reports: { clinic_id: string } | null }[]> {
  const { data, error } = await db
    .from("system_report_messages")
    .select("created_at, system_reports ( clinic_id )")
    .eq("kind", "resposta")
    .gte("created_at", desde)
    .limit(5000);
  if (error) throw new Error(`respostas: ${error.code ?? ""}`);
  return (data ?? []) as unknown as {
    created_at: string;
    system_reports: { clinic_id: string } | null;
  }[];
}

/** O escopo de quem abriu o painel — a mesma régua da 0258. */
function escopoDe(
  session: SessionContext,
  clinicIdPedida: string | null
): { rede: boolean; unidades: string[] | null; minhas: string[] } {
  const papeis = Object.entries(session.rolesByClinic);
  const rede =
    session.isAdminMaster ||
    session.clinics.some(
      (c) => c.type === "franchisor" && (session.rolesByClinic[c.id] ?? []).length > 0
    );
  const minhas = papeis
    .filter(([, rs]) => rs.some((r) => r === "unit_manager" || r === "franchisee"))
    .map(([id]) => id);

  if (rede) {
    return {
      rede: true,
      unidades: clinicIdPedida ? [clinicIdPedida] : null,
      minhas,
    };
  }
  if (minhas.length === 0) throw new SemPermissaoNoPainel("NOT_ALLOWED");
  if (clinicIdPedida) {
    if (!minhas.includes(clinicIdPedida)) throw new SemPermissaoNoPainel("NOT_ALLOWED");
    return { rede: false, unidades: [clinicIdPedida], minhas };
  }
  return { rede: false, unidades: minhas, minhas };
}

export type FiltroDeAmbiente = "todos" | "sistema" | "treino";

export type PainelConsolidado = {
  painel: PainelDeRelatos;
  /** Quantos relatos vieram de cada lado, no período (para a tela dizer). */
  contagemPorAmbiente: { sistema: number; treino: number };
  /** Não deu para ler o treino: a tela avisa em vez de somar errado. */
  aviso?: string;
};

export async function carregarPainel(entrada: {
  session: SessionContext;
  periodo: { de: string; ate: string };
  clinicId: string | null;
  ambiente: FiltroDeAmbiente;
}): Promise<PainelConsolidado> {
  const { rede, unidades, minhas } = escopoDe(entrada.session, entrada.clinicId);
  const prod = createAdminClient();

  // As unidades que o filtro da tela oferece.
  const { data: clinicasProd } = await prod
    .from("clinics")
    .select("id, name, code, is_active")
    .order("name")
    .returns<{ id: string; name: string; code: string | null; is_active: boolean }[]>();
  const unidadesDoEscopo = (clinicasProd ?? [])
    .filter((c) => (rede ? c.is_active : minhas.includes(c.id)))
    .map((c) => ({ id: c.id, nome: c.name }));

  const desde = `${entrada.periodo.de}T00:00:00.000Z`;
  const relatos: RelatoCru[] = [];
  const respostas: RespostaCrua[] = [];
  let aviso: string | undefined;
  const contagem = { sistema: 0, treino: 0 };

  const juntar = (
    linhas: LinhaDeRelato[],
    ambiente: "sistema" | "treino",
    unidadeLocalParaProd: Map<string, string>,
    pessoaLocalParaProd: Map<string, string>
  ) => {
    for (const r of linhas) {
      relatos.push({
        code: r.code,
        kind: r.kind,
        status: r.status,
        modulo: (r.module ?? null) as ModuloDoSistema | null,
        // O treino tem ids próprios: traduzidos, as duas pontas somam na mesma
        // unidade e na mesma pessoa em vez de virarem duas linhas.
        clinicId: unidadeLocalParaProd.get(r.clinic_id) ?? r.clinic_id,
        clinicNome: r.clinics?.name ?? "—",
        reporterId: pessoaLocalParaProd.get(r.reporter_id) ?? r.reporter_id,
        reporterNome: r.profiles?.full_name ?? "—",
        reporterPapel: r.reporter_role,
        reporterEhAdmin: r.profiles?.is_admin_master ?? false,
        criadoEm: r.created_at,
        primeiraRespostaEm: r.first_response_at,
        encerradoEm: r.closed_at,
        reaberturas: r.reopened_count ?? 0,
        ambiente,
      });
    }
  };

  if (entrada.ambiente !== "treino") {
    const { linhas } = await lerRelatos(prod, "sistema");
    contagem.sistema = linhas.length;
    juntar(linhas, "sistema", new Map(), new Map());
    for (const m of await lerRespostas(prod, desde)) {
      if (m.system_reports) {
        respostas.push({ criadaEm: m.created_at, clinicId: m.system_reports.clinic_id });
      }
    }
  }

  if (entrada.ambiente !== "sistema" && podeOlharOTreino()) {
    const treino = clienteDoTreino();
    if (treino) {
      try {
        const [{ data: clinicasTreino }, { data: ponte }] = await Promise.all([
          treino.from("clinics").select("id, code").returns<{ id: string; code: string | null }[]>(),
          treino
            .from("mirror_user_map")
            .select("source_id, local_id")
            .returns<{ source_id: string; local_id: string }[]>(),
        ]);
        // A cópia (0260) casa as unidades pelo CÓDIGO e cria no treino as que
        // faltam com o MESMO id da produção. Então: mesmo código = mesma
        // unidade; sem código correspondente, a unidade é só do treino e fica
        // com o id dela (aparece como uma linha própria, que é a verdade).
        const prodPorCodigo = new Map(
          (clinicasProd ?? [])
            .filter((c) => c.code)
            .map((c) => [c.code!.toUpperCase(), c.id] as const)
        );
        const unidadeMap = new Map<string, string>();
        for (const c of clinicasTreino ?? []) {
          const naProd = c.code ? prodPorCodigo.get(c.code.toUpperCase()) : undefined;
          if (naProd) unidadeMap.set(c.id, naProd);
        }
        const pessoaMap = new Map<string, string>();
        for (const m of ponte ?? []) pessoaMap.set(m.local_id, m.source_id);

        const { linhas } = await lerRelatos(treino, "treino");
        contagem.treino = linhas.length;
        juntar(linhas, "treino", unidadeMap, pessoaMap);
        for (const m of await lerRespostas(treino, desde)) {
          if (m.system_reports) {
            const local = m.system_reports.clinic_id;
            respostas.push({
              criadaEm: m.created_at,
              clinicId: unidadeMap.get(local) ?? local,
            });
          }
        }
      } catch (e) {
        console.error("painel: treino", e instanceof Error ? e.message : typeof e);
        aviso =
          "Não foi possível ler o ambiente de treino agora: os números abaixo são só do sistema.";
      }
    }
  }

  return {
    painel: montarPainel({
      relatos,
      respostas,
      periodo: entrada.periodo,
      rede,
      unidades,
      unidadesDoEscopo,
    }),
    contagemPorAmbiente: contagem,
    aviso,
  };
}
