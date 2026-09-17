import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ehModulo,
  type MensagemDeRelato,
  type Relato,
  type SituacaoDeRelato,
} from "@/lib/system-reports";
import type { AnexoExibido } from "./anexos";

/**
 * QUEM CARREGA OS RELATOS — a lista e o detalhe leem daqui.
 *
 * ⚠️ O BANCO PODE ESTAR SEM A 0256 quando o código chegar ao ar (código viaja
 * sozinho; migração, não — CLAUDE.md §0b). Nesse intervalo a consulta nova
 * falha por coluna inexistente, e a tela de Problemas SUMIRIA para a equipe
 * inteira até alguém rodar a migração. Então a leitura cai para as colunas da
 * 0247/0252, a tela funciona como antes, e o `nivel` diz o que falta.
 */

export type NivelDoBanco = "completo" | "sem_0256" | "sem_tabela";

const COLUNAS_BASE =
  "id, code, kind, severity, title, what_happened, expected, screen, app_version, error_digest, user_agent, status, answer, answered_at, resolved_version, created_at, reporter_role, reporter_id, clinic_id, profiles!system_reports_reporter_id_fkey ( full_name ), clinics ( name )";

// `reporter_seen_answer_at` é da 0252 e `module`/relógio da 0256; a conversa
// vem embutida só com o necessário para a lista (quem falou por último e
// quantas respostas) — o texto das mensagens fica para o detalhe.
const COLUNAS_0256 = `${COLUNAS_BASE}, module, status_changed_at, closed_at, first_response_at, reopened_count, reporter_seen_answer_at, system_report_messages ( seq, kind )`;

type Bruto = {
  id: string;
  code: string;
  kind: Relato["kind"];
  severity: Relato["severity"];
  title: string;
  what_happened: string;
  expected: string | null;
  screen: string | null;
  app_version: string | null;
  error_digest: string | null;
  user_agent: string | null;
  status: SituacaoDeRelato;
  answer: string | null;
  answered_at: string | null;
  resolved_version: string | null;
  created_at: string;
  reporter_role: string | null;
  reporter_id: string;
  clinic_id: string;
  profiles: { full_name: string } | null;
  clinics: { name: string } | null;
  module?: string | null;
  status_changed_at?: string | null;
  closed_at?: string | null;
  first_response_at?: string | null;
  reopened_count?: number | null;
  reporter_seen_answer_at?: string | null;
  system_report_messages?: { seq: number; kind: MensagemDeRelato["kind"] }[];
};

/** Erro de "coluna/relação não existe" — o sinal de migração pendente. */
function faltaEstrutura(code: string | undefined): boolean {
  // 42703 coluna inexistente; PGRST200 relação (embed) desconhecida;
  // PGRST204 coluna fora do cache do PostgREST.
  return code === "42703" || code === "PGRST200" || code === "PGRST204";
}

function montar(r: Bruto, userId: string): Relato {
  const conversa = [...(r.system_report_messages ?? [])].sort((a, b) => a.seq - b.seq);
  const falas = conversa.filter((m) => m.kind !== "situacao");
  const ultima = falas[falas.length - 1];
  // Banco sem a 0256 não tem conversa: vale a resposta única da 0247.
  const respostas = r.system_report_messages
    ? falas.filter((m) => m.kind === "resposta").length
    : r.answer
      ? 1
      : 0;

  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    whatHappened: r.what_happened,
    expected: r.expected,
    screen: r.screen,
    module: ehModulo(r.module) ? r.module : null,
    appVersion: r.app_version,
    errorDigest: r.error_digest,
    userAgent: r.user_agent,
    status: r.status,
    answer: r.answer,
    answeredAt: r.answered_at,
    resolvedVersion: r.resolved_version,
    createdAt: r.created_at,
    statusChangedAt: r.status_changed_at ?? null,
    closedAt: r.closed_at ?? null,
    firstResponseAt: r.first_response_at ?? r.answered_at,
    reopenedCount: r.reopened_count ?? 0,
    reporterRole: r.reporter_role,
    reporterName: r.profiles?.full_name ?? "—",
    clinicId: r.clinic_id,
    clinicName: r.clinics?.name ?? "—",
    meu: r.reporter_id === userId,
    // Sem a coluna da 0252 não há como saber — trata como lida, para a
    // etiqueta não acender em tudo o que já foi respondido um dia.
    respostaLida:
      r.reporter_seen_answer_at === undefined ? true : r.reporter_seen_answer_at !== null,
    respostas,
    ultimaFalaDoRelator:
      ultima !== undefined && (ultima.kind === "complemento" || ultima.kind === "reabertura"),
  };
}

export async function carregarRelatos(
  supabase: SupabaseClient,
  userId: string,
  filtro?: { code?: string }
): Promise<{ relatos: Relato[]; nivel: NivelDoBanco }> {
  const consultar = (colunas: string) => {
    let q = supabase.from("system_reports").select(colunas);
    if (filtro?.code) q = q.eq("code", filtro.code);
    // 500 cobre com folga a operação de hoje (~15 pessoas). A RLS já limita ao
    // que a pessoa pode ver; a consulta não repete a régua.
    return q.order("created_at", { ascending: false }).limit(500);
  };

  const novo = await consultar(COLUNAS_0256);
  if (!novo.error) {
    return {
      relatos: (novo.data as unknown as Bruto[]).map((r) => montar(r, userId)),
      nivel: "completo",
    };
  }
  if (novo.error.code === "42P01") return { relatos: [], nivel: "sem_tabela" };
  if (!faltaEstrutura(novo.error.code)) throw new Error(novo.error.message);

  const antigo = await consultar(COLUNAS_BASE);
  if (antigo.error) {
    if (antigo.error.code === "42P01") return { relatos: [], nivel: "sem_tabela" };
    throw new Error(antigo.error.message);
  }
  return {
    relatos: (antigo.data as unknown as Bruto[]).map((r) => montar(r, userId)),
    nivel: "sem_0256",
  };
}

type MensagemBruta = {
  id: string;
  seq: number;
  kind: MensagemDeRelato["kind"];
  body: string | null;
  status_from: SituacaoDeRelato | null;
  status_to: SituacaoDeRelato | null;
  created_at: string;
  author_id: string | null;
  profiles: { full_name: string } | null;
};

/**
 * A conversa de UM relato. Banco sem a 0256: devolve a resposta única da 0247
 * como se fosse a conversa, para o detalhe mostrar o que existe.
 */
export async function carregarConversa(
  supabase: SupabaseClient,
  relato: Relato,
  reporterId: string | null
): Promise<MensagemDeRelato[]> {
  const { data, error } = await supabase
    .from("system_report_messages")
    .select(
      "id, seq, kind, body, status_from, status_to, created_at, author_id, profiles ( full_name )"
    )
    .eq("report_id", relato.id)
    .order("seq", { ascending: true });

  if (error) {
    if (!relato.answer) return [];
    return [
      {
        id: "legado",
        seq: 1,
        kind: "resposta",
        body: relato.answer,
        statusFrom: null,
        statusTo: null,
        createdAt: relato.answeredAt ?? relato.createdAt,
        authorName: "Suporte",
        doRelator: false,
      },
    ];
  }

  return (data as unknown as MensagemBruta[]).map((m) => ({
    id: m.id,
    seq: m.seq,
    kind: m.kind,
    body: m.body,
    statusFrom: m.status_from,
    statusTo: m.status_to,
    createdAt: m.created_at,
    // ⚠️ O NOME PODE NÃO VOLTAR, e isso é a RLS de `profiles` funcionando: a
    // recepção só lê o perfil de quem divide unidade com ela, e o Admin Master
    // não divide. Quem escreve fora de quem relatou é o suporte (as portas da
    // 0256 garantem), então é esse o nome honesto. Sem autor nenhum = mudança
    // feita direto no banco, sem usuário.
    authorName:
      m.profiles?.full_name ??
      (m.author_id === null
        ? "Sistema"
        : m.author_id === reporterId
          ? relato.reporterName
          : "Suporte Risarte"),
    doRelator: m.author_id !== null && m.author_id === reporterId,
  }));
}

/** O id de quem relatou — o detalhe precisa dele para separar as falas. */
export async function reporterDoRelato(
  supabase: SupabaseClient,
  reportId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("system_reports")
    .select("reporter_id")
    .eq("id", reportId)
    .maybeSingle<{ reporter_id: string }>();
  return data?.reporter_id ?? null;
}

/**
 * O instante do pedido, lido UMA vez pela página no servidor.
 *
 * A regra de pureza do React reprova `Date.now()` no corpo do componente —
 * com razão num componente de navegador, que redesenha. Aqui é página de
 * servidor, desenhada uma vez por pedido: o número é tirado aqui e ENTREGUE
 * ao navegador como propriedade, para os dois lados calcularem "há quanto
 * tempo" com o mesmo relógio e o desenho não divergir.
 */
export function instanteDoPedido(): number {
  return Date.now();
}

// -----------------------------------------------------------------------------
// Anexos (0257)
// -----------------------------------------------------------------------------

type AnexoBruto = {
  id: string;
  message_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: "captura" | "arquivo";
  created_at: string;
  storage_path: string;
  uploaded_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  // Duas chaves para `profiles` (quem enviou, quem removeu): o embed precisa
  // do nome da chave, senão o PostgREST recusa por ambiguidade.
  removedor: { full_name: string } | null;
};

export type AnexosDoRelato = {
  /** `false` = banco sem a 0257: a tela esconde os seletores. */
  ligados: boolean;
  doRelato: AnexoExibido[];
  porMensagem: Record<string, AnexoExibido[]>;
};

/**
 * Os anexos de um relato, com link temporário de UMA hora. O link nasce aqui,
 * no servidor, com a sessão de quem abriu: a política do bucket decide de novo
 * se a pessoa pode ver cada arquivo.
 */
export async function carregarAnexos(
  supabase: SupabaseClient,
  relato: Relato,
  quem: { userId: string; isAdminMaster: boolean; reporterId: string | null }
): Promise<AnexosDoRelato> {
  const { data, error } = await supabase
    .from("system_report_attachments")
    .select(
      "id, message_id, file_name, mime_type, size_bytes, kind, created_at, storage_path, uploaded_by, removed_at, removed_by, removedor:profiles!system_report_attachments_removed_by_fkey ( full_name )"
    )
    .eq("report_id", relato.id)
    .order("created_at", { ascending: true });

  if (error) return { ligados: false, doRelato: [], porMensagem: {} };

  const linhas = data as unknown as AnexoBruto[];
  const vivos = linhas.filter((a) => !a.removed_at).map((a) => a.storage_path);
  const urls = new Map<string, string>();
  if (vivos.length > 0) {
    const { data: assinados } = await supabase.storage
      .from("system-reports")
      .createSignedUrls(vivos, 3600);
    for (const s of assinados ?? []) {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    }
  }

  const doRelato: AnexoExibido[] = [];
  const porMensagem: Record<string, AnexoExibido[]> = {};
  for (const a of linhas) {
    const exibido: AnexoExibido = {
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      sizeBytes: Number(a.size_bytes),
      kind: a.kind,
      createdAt: a.created_at,
      url: a.removed_at ? null : (urls.get(a.storage_path) ?? null),
      removido: a.removed_at
        ? {
            quando: a.removed_at,
            // Mesmo raciocínio da conversa: a RLS de `profiles` pode esconder
            // o nome do Admin Master de quem é da unidade.
            quem:
              a.removedor?.full_name ??
              (a.removed_by === quem.reporterId ? relato.reporterName : "o suporte"),
          }
        : null,
      podeRemover:
        !a.removed_at && (quem.isAdminMaster || a.uploaded_by === quem.userId),
    };
    if (a.message_id) (porMensagem[a.message_id] ??= []).push(exibido);
    else doRelato.push(exibido);
  }

  return { ligados: true, doRelato, porMensagem };
}
