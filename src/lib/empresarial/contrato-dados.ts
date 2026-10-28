import "server-only";

import type { empresarialDb } from "./db";
import { lerGenero } from "./contrato";
import type {
  BlocoDoContrato,
  Contratada,
  ModeloDeContrato,
} from "./contrato";

// Risarte Empresarial — AS LEITURAS DO CONTRATO (1027).
//
// Três telas leem o mesmo par de tabelas (Configurações, o contrato da empresa
// e o editor do texto da empresa). Lendo cada uma do seu jeito, uma delas
// passaria a mostrar o modelo antigo no dia em que a tabela ganhasse coluna.
//
// ⚠️ LEITURA QUE FALHA DEVOLVE `erro`, NUNCA "NÃO EXISTE". Entre o deploy e o
// dia em que a 1027 roda, as tabelas não existem — e "não há modelo" seria a
// tela concluindo o que ela não mediu (CLAUDE.md §0d).

type Db = Awaited<ReturnType<typeof empresarialDb>>;

type ModeloRow = {
  lead_id: string | null;
  title: string;
  preamble: string;
  sections: BlocoDoContrato[] | null;
  closing: string | null;
};

const paraModelo = (r: ModeloRow): ModeloDeContrato => ({
  titulo: r.title,
  preambulo: r.preamble,
  blocos: Array.isArray(r.sections) ? r.sections : [],
  fecho: r.closing ?? "",
});

export type ModelosDoContrato = {
  /** O modelo da rede. `null` = não há linha da rede no banco. */
  daRede: ModeloDeContrato | null;
  /** O texto personalizado desta empresa, quando existe. */
  daEmpresa: ModeloDeContrato | null;
  erro: string | null;
};

/** O modelo da rede e, com `leadId`, o texto personalizado daquela empresa. */
export async function lerModelosDoContrato(
  db: Db,
  leadId: string | null
): Promise<ModelosDoContrato> {
  const consulta = db
    .from("contract_templates")
    .select("lead_id, title, preamble, sections, closing");
  const { data, error } = await (
    leadId
      ? consulta.or(`lead_id.eq.${leadId},lead_id.is.null`)
      : consulta.is("lead_id", null)
  ).returns<ModeloRow[]>();
  if (error) {
    console.error("modelo do contrato:", error.message);
    return { daRede: null, daEmpresa: null, erro: error.message };
  }
  const rede = data?.find((m) => !m.lead_id);
  const empresa = leadId ? data?.find((m) => m.lead_id === leadId) : undefined;
  return {
    daRede: rede ? paraModelo(rede) : null,
    daEmpresa: empresa ? paraModelo(empresa) : null,
    erro: null,
  };
}

type ContratadaRow = {
  legal_name: string | null;
  cnpj: string | null;
  address: string | null;
  rep_name: string | null;
  rep_role: string | null;
  rep_nationality: string | null;
  rep_rg: string | null;
  rep_cpf: string | null;
  signing_city: string | null;
  /** 1037. Ausente = a migração ainda não rodou neste banco. */
  rep_gender?: string | null;
};

/** A parte da Risarte no contrato. `contratada: null` = linha ainda não existe. */
export async function lerContratada(
  db: Db
): Promise<{ contratada: Contratada | null; erro: string | null }> {
  const { data, error } = await db
    .from("contract_settings")
    // "*" e não a lista: a coluna do gênero (1037) chega com a migração, que
    // viaja à mão. Pedir uma coluna que ainda não existe derrubaria o contrato
    // inteiro entre o deploy e o dia em que a migração rodar.
    .select("*")
    .maybeSingle<ContratadaRow>();
  if (error) {
    console.error("dados da contratada:", error.message);
    return { contratada: null, erro: error.message };
  }
  if (!data) return { contratada: null, erro: null };
  return {
    contratada: {
      legalName: data.legal_name,
      cnpj: data.cnpj,
      address: data.address,
      repName: data.rep_name,
      repRole: data.rep_role,
      repNationality: data.rep_nationality,
      repRg: data.rep_rg,
      repCpf: data.rep_cpf,
      signingCity: data.signing_city,
      // undefined = coluna ausente (a tela não oferece a escolha); null = não escolhido.
      repGender: "rep_gender" in data ? lerGenero(data.rep_gender) : undefined,
    },
    erro: null,
  };
}
