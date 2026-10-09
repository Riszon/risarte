// AUDITORIA DE ALTERAÇÕES (0288) — a parte que traduz e organiza.
//
// O banco grava cada inclusão, alteração e exclusão em `audit_changes`, com o
// antes e o depois de cada campo. Aqui isso vira frase de gente: "Alterou ·
// Cliente · FRA-00012 · Maria — Telefone: (43) 9… → (43) 8…".
//
// Tudo puro e testado (`auditoria-alteracoes.test.ts`): nenhuma tela decide
// sozinha como mostrar um valor.

import { MOTIVO_ROTULO } from "@/lib/acesso";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  ATTENDANCE_LABELS,
} from "@/lib/appointments";
import {
  AREAS,
  CAMPOS,
  PALAVRAS,
  SUFIXOS_DE_DINHEIRO,
  TABELAS,
} from "@/lib/auditoria-catalogo";
import { PAYMENT_METHOD_LABELS } from "@/lib/commercial";
import { BRAZIL_TIME_ZONE, formatIsoDateBr } from "@/lib/dates";
import { PHASE_LABELS, PILLAR_LABELS, STATUS_LABELS } from "@/lib/journey";
import { PLAN_STATUS_LABELS } from "@/lib/planning";
import { formatBRL } from "@/lib/pricing";
import { ROLE_LABELS, UNIT_SCOPE_LABELS } from "@/lib/roles";

export type Operacao = "I" | "U" | "D";

export const OPERACOES: Operacao[] = ["I", "U", "D"];

export const OPERACAO_ROTULO: Record<Operacao, string> = {
  I: "Cadastrou",
  U: "Alterou",
  D: "Excluiu",
};

export function lerOperacao(v: unknown): Operacao | "" {
  return v === "I" || v === "U" || v === "D" ? v : "";
}

export type Autor = "usuario" | "servico" | "sistema";

export type Alteracao = {
  id: number;
  occurred_at: string;
  user_id: string | null;
  actor: Autor;
  auth_session_id: string | null;
  schema_name: string;
  table_name: string;
  op: Operacao;
  row_id: string | null;
  row_label: string | null;
  clinic_id: string | null;
  client_id: string | null;
  changes: Record<string, unknown> | null;
  tx: number | null;
};

/** As colunas que a tela pede ao banco (uma lista só, para não divergir). */
export const COLUNAS_DA_ALTERACAO =
  "id, occurred_at, user_id, actor, auth_session_id, schema_name, table_name, op, row_id, row_label, clinic_id, client_id, changes, tx";

// ---------------------------------------------------------------- tabelas

export function chaveDaTabela(schema: string, tabela: string): string {
  return `${schema}.${tabela}`;
}

export function tabelaTemRotulo(schema: string, tabela: string): boolean {
  return chaveDaTabela(schema, tabela) in TABELAS;
}

/** Nome em português; tabela sem rótulo aparece pelo nome técnico (nunca some). */
export function rotuloDaTabela(schema: string, tabela: string): string {
  return TABELAS[chaveDaTabela(schema, tabela)] ?? tabela;
}

export function rotuloDaArea(schema: string): string {
  return AREAS[schema] ?? schema;
}

/** Opções do filtro "o que foi mexido", em ordem alfabética do rótulo. */
export function opcoesDeTabela(): { value: string; label: string }[] {
  return Object.entries(TABELAS)
    .map(([value, label]) => {
      const area = value.split(".")[0];
      // Não repete a área em quem já a traz no nome ("Campanha do Indica +Risos").
      const nomeDaArea = rotuloDaArea(area);
      return {
        value,
        label:
          area === "public" || label.includes(nomeDaArea)
            ? label
            : `${label} (${nomeDaArea})`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** `schema.tabela` vindo da URL → as duas partes, só se for tabela conhecida. */
export function lerTabela(v: unknown): { schema: string; tabela: string } | null {
  if (typeof v !== "string" || !(v in TABELAS)) return null;
  const [schema, tabela] = v.split(".");
  return { schema, tabela };
}

// ----------------------------------------------------------------- campos

/**
 * Rótulo do campo: o escrito à mão, senão palavra a palavra. O que não tem
 * tradução fica como está — melhor um nome técnico que um nome inventado.
 */
export function rotuloDoCampo(campo: string): string {
  const pronto = CAMPOS[campo];
  if (pronto) return pronto;
  let base = campo;
  for (const s of [...SUFIXOS_DE_DINHEIRO, "_id"]) {
    if (base.endsWith(s) && base.length > s.length) {
      base = base.slice(0, -s.length);
      break;
    }
  }
  const palavras = base
    .split("_")
    .map((p) => (p in PALAVRAS ? PALAVRAS[p] : p))
    .filter((p) => p !== "");
  const frase = palavras.join(" ").trim();
  if (!frase) return campo;
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

function ehDinheiro(campo: string): boolean {
  return SUFIXOS_DE_DINHEIRO.some((s) => campo.endsWith(s));
}

// ----------------------------------------------------------------- valores

/** Nomes que a tela já carregou, para trocar identificador por gente. */
export type Nomes = {
  usuarios: Map<string, string>;
  unidades: Map<string, string>;
  /** "FRA-00012 · Maria" dos clientes que aparecem na lista (quando carregados). */
  clientes?: Map<string, string>;
};

/** A continuação da vida do plano depois de aprovado (enum do banco). */
const SITUACAO_DO_PLANO: Record<string, string> = {
  aguardando_apresentacao: "Aguardando apresentação",
  apresentado: "Apresentado",
  aceito: "Aceito",
  reprovado: "Reprovado",
  em_tratamento: "Em tratamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  suspenso: "Suspenso",
};

const VALORES_POR_CAMPO: Record<string, Record<string, string>> = {
  lifecycle: SITUACAO_DO_PLANO,
  role: ROLE_LABELS,
  papel: { ...ROLE_LABELS, "*": "Todas as funções", admin_master: "Admin Master" },
  unit_scope: UNIT_SCOPE_LABELS,
  journey_phase: PHASE_LABELS,
  journey_status: STATUS_LABELS,
  methodology_pillar: PILLAR_LABELS,
  pillar: PILLAR_LABELS,
  attendance: ATTENDANCE_LABELS,
  payment_method: PAYMENT_METHOD_LABELS,
};

const VALORES_POR_TABELA_E_CAMPO: Record<string, Record<string, string>> = {
  "public.appointments.type": APPOINTMENT_TYPE_LABELS,
  "public.appointments.status": APPOINTMENT_STATUS_LABELS,
  "public.treatment_plans.status": PLAN_STATUS_LABELS,
  "public.clients.status": {
    active: "Ativo",
    inactive: "Inativo",
    anonymized: "Anonimizado",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DATA_E_HORA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export const VAZIO = "(vazio)";
export const OCULTO = "(oculto — é um segredo)";

function dataEHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Um valor gravado → o que a pessoa lê. Regra: traduzir o que se SABE
 * traduzir (sim/não, dinheiro, data, função, fase, nome de gente e de
 * unidade) e mostrar o resto exatamente como está no banco.
 */
export function formatarValor(
  schema: string,
  tabela: string,
  campo: string,
  valor: unknown,
  nomes: Nomes
): string {
  if (valor === null || valor === undefined || valor === "") return VAZIO;
  if (valor === "[oculto]") return OCULTO;
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") {
    return ehDinheiro(campo) ? formatBRL(valor) : String(valor).replace(".", ",");
  }
  if (Array.isArray(valor)) {
    if (valor.length === 0) return "(nenhum)";
    return valor
      .map((v) => formatarValor(schema, tabela, campo, v, nomes))
      .join(", ");
  }
  if (typeof valor === "object") return JSON.stringify(valor);
  const texto = String(valor);
  const porTabela = VALORES_POR_TABELA_E_CAMPO[`${schema}.${tabela}.${campo}`];
  if (porTabela && texto in porTabela) return porTabela[texto];
  const porCampo = VALORES_POR_CAMPO[campo];
  if (porCampo && texto in porCampo) return porCampo[texto];
  if (UUID.test(texto)) {
    const gente = nomes.usuarios.get(texto);
    if (gente) return gente;
    const unidade = nomes.unidades.get(texto);
    if (unidade) return unidade;
    const cliente = nomes.clientes?.get(texto);
    if (cliente) return cliente;
    return `registro ${texto.slice(0, 8)}…`;
  }
  if (DATA.test(texto)) return formatIsoDateBr(texto);
  if (DATA_E_HORA.test(texto)) return dataEHora(texto);
  return texto;
}

// ------------------------------------------------- detalhes de uma AÇÃO
//
// A trilha de ações (`audit_logs`) guarda, ao lado de cada ação, uns poucos
// detalhes que a tela escolheu: "de qual fase para qual", "foi forçado",
// "como entrou". As chaves não são colunas — têm rótulo próprio.

const DETALHES: Record<string, string> = {
  from: "De",
  to: "Para",
  forcado: "Forçado pelo Admin",
  origem: "Como entrou",
  motivo: "Motivo",
};

const VALORES_DOS_DETALHES: Record<string, string> = {
  ...PHASE_LABELS,
  ...STATUS_LABELS,
  ...SITUACAO_DO_PLANO,
  ...MOTIVO_ROTULO,
  login: "login com senha",
  retomada: "já estava logado",
};

export function rotuloDoDetalhe(chave: string): string {
  return DETALHES[chave] ?? rotuloDoCampo(chave);
}

export function formatarDetalhe(chave: string, valor: unknown, nomes: Nomes): string {
  const pronto = formatarValor("public", "", chave, valor, nomes);
  return typeof valor === "string" && pronto === valor && valor in VALORES_DOS_DETALHES
    ? VALORES_DOS_DETALHES[valor]
    : pronto;
}

// --------------------------------------------------------- campo a campo

export type CampoAlterado = {
  campo: string;
  rotulo: string;
  /** Nulo = não se aplica (numa inclusão não existe "antes"). */
  antes: string | null;
  depois: string | null;
};

/**
 * Campos que não dizem nada numa inclusão/exclusão: a chave, e o "quem/quando
 * criou" — que a linha da auditoria já mostra por conta própria.
 */
const RUIDO_FORA_DA_ALTERACAO = new Set([
  "id",
  "created_at",
  "criado_em",
  "updated_at",
  "atualizado_em",
]);

function ehAntesEDepois(v: unknown): v is { antes: unknown; depois: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "antes" in v &&
    "depois" in v
  );
}

/** A lista "campo · antes · depois" de um registro da auditoria. */
export function camposDaAlteracao(a: Alteracao, nomes: Nomes): CampoAlterado[] {
  const mudancas = a.changes ?? {};
  const linhas: CampoAlterado[] = [];
  for (const campo of Object.keys(mudancas)) {
    const v = mudancas[campo];
    const f = (x: unknown) =>
      formatarValor(a.schema_name, a.table_name, campo, x, nomes);
    if (a.op === "U") {
      if (!ehAntesEDepois(v)) continue;
      linhas.push({
        campo,
        rotulo: rotuloDoCampo(campo),
        antes: f(v.antes),
        depois: f(v.depois),
      });
    } else {
      if (RUIDO_FORA_DA_ALTERACAO.has(campo)) continue;
      linhas.push({
        campo,
        rotulo: rotuloDoCampo(campo),
        antes: a.op === "D" ? f(v) : null,
        depois: a.op === "I" ? f(v) : null,
      });
    }
  }
  return linhas;
}

/** "Telefone, E-mail e mais 3" — o que mudou, numa linha. Só para alteração. */
export function resumoDosCampos(a: Alteracao, maximo = 4): string {
  if (a.op !== "U") return "";
  const nomes = Object.keys(a.changes ?? {}).map(rotuloDoCampo);
  if (nomes.length <= maximo) return nomes.join(", ");
  return `${nomes.slice(0, maximo).join(", ")} e mais ${nomes.length - maximo}`;
}

// ------------------------------------------------------------- quem e onde

/** Quem fez: a pessoa, ou — quando não foi uma pessoa logada — o sistema. */
export function quemFez(
  a: Pick<Alteracao, "user_id" | "actor">,
  nomes: Nomes
): string {
  if (a.user_id) return nomes.usuarios.get(a.user_id) ?? "Usuário removido";
  return a.actor === "servico"
    ? "Sistema (em nome de alguém)"
    : "Sistema (rotina automática)";
}

export const EXPLICACAO_DO_SISTEMA =
  "“Sistema (em nome de alguém)” é o servidor gravando depois de conferir a " +
  "permissão da pessoa — a ação dela aparece no mesmo horário, na aba Ações. " +
  "“Sistema (rotina automática)” são as tarefas agendadas e as regras do banco.";

/** Para onde o registro leva: hoje, o prontuário do cliente envolvido. */
export function destinoDoRegistro(
  a: Pick<Alteracao, "client_id">
): string | null {
  return a.client_id ? `/prontuarios/${a.client_id}` : null;
}

/**
 * O nome do registro. Na ordem: o rótulo que o banco tirou dele (código e
 * nome); o cliente a que ele pertence (agendamento, sessão e parcela não têm
 * nome próprio — o que os identifica é DE QUEM são); por último, a chave curta.
 */
export function nomeDoRegistro(
  a: Pick<Alteracao, "row_label" | "row_id"> &
    Partial<Pick<Alteracao, "client_id" | "schema_name" | "table_name">>,
  nomes?: Nomes
): string {
  const ehOProprioCliente = a.schema_name === "public" && a.table_name === "clients";
  const cliente =
    a.client_id && !ehOProprioCliente ? nomes?.clientes?.get(a.client_id) : undefined;
  if (a.row_label) return cliente ? `${a.row_label} — ${cliente}` : a.row_label;
  if (cliente) return `de ${cliente}`;
  if (!a.row_id) return "—";
  if (UUID.test(a.row_id)) return `${a.row_id.slice(0, 8)}…`;
  // Chave que é texto (a função, a permissão): traduz o que for função.
  const papeis: Record<string, string> = VALORES_POR_CAMPO.papel;
  return a.row_id
    .split(",")
    .map((p) => papeis[p] ?? p)
    .join(" · ");
}

/** Os clientes citados numa lista de alterações (para buscar os nomes de uma vez). */
export function clientesCitados(lista: Pick<Alteracao, "client_id">[]): string[] {
  return [...new Set(lista.map((a) => a.client_id).filter((x): x is string => !!x))];
}

// ------------------------------------------------------- o dia de alguém

/** Dia `AAAA-MM-DD` válido vindo da URL, ou vazio. */
export function lerDia(v: unknown): string {
  return typeof v === "string" && DATA.test(v) && !Number.isNaN(Date.parse(v))
    ? v
    : "";
}

export type ContagemDoDia = {
  cadastrou: number;
  alterou: number;
  excluiu: number;
  /** Quantos registros DIFERENTES foram mexidos. */
  registros: number;
};

export function contarAlteracoes(
  lista: Pick<Alteracao, "op" | "schema_name" | "table_name" | "row_id">[]
): ContagemDoDia {
  const registros = new Set<string>();
  const c: ContagemDoDia = { cadastrou: 0, alterou: 0, excluiu: 0, registros: 0 };
  for (const a of lista) {
    if (a.op === "I") c.cadastrou++;
    else if (a.op === "U") c.alterou++;
    else c.excluiu++;
    registros.add(`${a.schema_name}.${a.table_name}:${a.row_id ?? ""}`);
  }
  c.registros = registros.size;
  return c;
}
