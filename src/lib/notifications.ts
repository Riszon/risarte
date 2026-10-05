// Notification categories for the notification center (F6). Notifications are
// stored with a free-text title (written by the DB functions); we classify them
// at read time by the title. Keep this in sync with the titles used in the
// migrations (e.g. "Plano aprovado", "Cliente compartilhado...", "Fechamento!
// Agendar início de tratamento", "Cliente transferido para outra unidade").

export const NOTIFICATION_CATEGORIES = [
  { key: "plano", label: "Plano de Tratamento" },
  { key: "comercial", label: "Comercial" },
  { key: "vendas_diretas", label: "Vendas Diretas" },
  { key: "ppr", label: "PPR+ (Prevenção)" },
  { key: "compartilhamento", label: "Compartilhamento" },
  { key: "inicio_tratamento", label: "Início de Tratamento" },
  { key: "agenda", label: "Agenda" },
  { key: "aniversario", label: "Aniversários" },
  { key: "transferencia", label: "Transferência" },
  // FIN7.3 — orçamento estourando, caixa negativo, ponto de equilíbrio, atraso.
  { key: "financeiro", label: "Financeiro" },
  { key: "outras", label: "Outras" },
] as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const NOTIFICATION_CATEGORY_LABELS = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [c.key, c.label])
) as Record<NotificationCategory, string>;

/** Color classes for a category chip/badge (tinted bg + readable text). */
export const NOTIFICATION_CATEGORY_CLASS: Record<NotificationCategory, string> = {
  plano: "bg-primary/10 text-primary",
  comercial: "bg-violet-100 text-violet-800",
  vendas_diretas: "bg-teal-100 text-teal-800",
  ppr: "bg-gold/20 text-gold-tinta",
  compartilhamento: "bg-emerald-100 text-emerald-800",
  inicio_tratamento: "bg-gold text-gold-foreground",
  agenda: "bg-red-100 text-red-800",
  aniversario: "bg-pink-100 text-pink-800",
  transferencia: "bg-amber-100 text-amber-800",
  financeiro: "bg-slate-200 text-slate-800",
  outras: "bg-muted text-muted-foreground",
};

/** Solid dot color for a category (used in the filter chips). */
export const NOTIFICATION_CATEGORY_DOT: Record<NotificationCategory, string> = {
  plano: "bg-primary",
  comercial: "bg-violet-500",
  vendas_diretas: "bg-teal-500",
  ppr: "bg-gold",
  compartilhamento: "bg-emerald-500",
  inicio_tratamento: "bg-gold",
  agenda: "bg-red-500",
  aniversario: "bg-pink-500",
  transferencia: "bg-amber-500",
  financeiro: "bg-slate-600",
  outras: "bg-muted-foreground",
};

/** Abas do prontuário (`TabPanel id` em prontuarios/[id]/page.tsx). */
export type AbaDoProntuario =
  | "pedidos"
  | "plano"
  | "sessoes"
  | "financeiro"
  | "jornada"
  | "historico";

/**
 * EM QUE ABA O AVISO ABRE O PRONTUÁRIO (OC-00093, 05/10/2026). Antes todo
 * aviso abria na aba Cadastro, e a pessoa tinha de adivinhar onde estava o
 * assunto. Mapa aprovado pelo dono, tirado das funções do banco que criam os
 * avisos (não de suposição).
 *
 * Pelo TÍTULO, como a categoria: assim os avisos já enviados também abrem na
 * aba certa, sem reescrever dado nenhum. O título começa sempre igual; o nome
 * do cliente vem depois dos dois-pontos.
 *
 * Fora do mapa de propósito: "Decisão urgente/obrigatória" e "Cliente
 * aguardando decisão" — a caixa da decisão fica no TOPO do prontuário, acima
 * das abas, então aparece em qualquer uma.
 */
const ABA_DO_AVISO: [prefixo: string, aba: AbaDoProntuario][] = [
  ["Pedido respondido", "pedidos"],
  ["Sugestão de reavaliação", "pedidos"],
  ["Revisão do plano solicitada", "pedidos"],
  ["Revisão do plano pendente", "pedidos"],

  ["Plano aguardando aprovação", "plano"],
  ["Plano aprovado", "plano"],
  ["Plano devolvido para revisão", "plano"],
  ["Plano aceito pelo cliente", "plano"],
  ["Plano reprovado pelo cliente", "plano"],
  ["Plano de tratamento para aprovação", "plano"],
  ["Plano de tratamento segue para outra unidade", "plano"],
  ["Novo caso no Centro de Planejamento", "plano"],

  ["Agendar sessões", "sessoes"],
  ["Agendar próxima sessão de tratamento", "sessoes"],
  ["Sessões reabertas", "sessoes"],
  ["Sessão atrasada", "sessoes"],
  ["Plano parado", "sessoes"],
  ["Procedimento para revisar", "sessoes"],
  ["Procedimento reprovado", "sessoes"],
  ["Novo procedimento para refazer", "sessoes"],
  ["Novo fechamento — acompanhar tratamento", "sessoes"],
  // O fechamento da venda direta é feito na aba Sessões & Procedimentos.
  ["Venda direta aguardando fechamento", "sessoes"],

  ["Renegociação", "financeiro"],

  ["Cliente em conversão clínica", "jornada"],
  ["Cliente retornou para conversão clínica", "jornada"],
  ["Cliente em reavaliação", "jornada"],
  ["Cliente em acompanhamento", "jornada"],
  ["Caso pronto para apresentação comercial", "jornada"],
  ["Caso comercial sem apresentação agendada", "jornada"],
  ["Caso devolvido pelo Centro de Planejamento", "jornada"],
  ["Apresentação comercial agendada", "jornada"],
  ["Agendar apresentação", "jornada"],
  ["Fechamento! Agendar início de tratamento", "jornada"],
  ["Cancelamento — agendar", "jornada"],

  ["Cliente compartilhado", "historico"],
  ["Compartilhamento encerrado", "historico"],
  ["Cliente transferido", "historico"],
  ["Seu cliente faltou", "historico"],
  ["Agendamento do seu cliente foi alterado", "historico"],
];

export function abaDoAviso(title: string): AbaDoProntuario | null {
  const t = (title ?? "").trim();
  return ABA_DO_AVISO.find(([prefixo]) => t.startsWith(prefixo))?.[1] ?? null;
}

/** Todas as abas que o mapa usa (a régua confere que elas existem na tela). */
export const ABAS_DOS_AVISOS: AbaDoProntuario[] = [
  ...new Set(ABA_DO_AVISO.map(([, aba]) => aba)),
];

const LINK_DO_CLIENTE = /^\/(?:clientes|prontuarios)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * O endereço que o "Abrir" do aviso usa. Aviso de cliente vai direto para
 * `/prontuarios/<id>` (os antigos guardam `/clientes/<id>`, que só chegava lá
 * por redirecionamento) e leva a aba. Qualquer outro endereço passa intacto.
 */
export function linkDoAviso(link: string, title: string): string {
  const m = LINK_DO_CLIENTE.exec(link ?? "");
  if (!m) return link;
  const aba = abaDoAviso(title);
  return `/prontuarios/${m[1]}${aba ? `?aba=${aba}` : ""}`;
}

export function categorizeNotification(title: string): NotificationCategory {
  const t = (title ?? "").toLowerCase();
  if (t.includes("aniversari")) return "aniversario";
  // Programa de Prevenção Riso+ — antes do "comercial" genérico.
  if (t.includes("ppr+") || t.includes("riso+")) return "ppr";
  // FIN7.3 — antes do "plano"/"comercial": "Orçamento estourando — ..." não é
  // orçamento de tratamento, é a meta de gasto do mês.
  if (
    t.includes("orçamento estourando") ||
    t.includes("caixa negativo") ||
    t.includes("ponto de equilíbrio") ||
    t.includes("atraso a receber")
  ) {
    return "financeiro";
  }
  if (t.startsWith("plano")) return "plano";
  // Venda direta na unidade (VD) — antes do "comercial" genérico.
  if (t.includes("venda direta")) return "vendas_diretas";
  // Conversão Comercial (H3.15): "apresentação comercial" pronta / sem agenda.
  if (t.includes("apresenta") || t.includes("comercial")) return "comercial";
  if (t.includes("compartilh")) return "compartilhamento";
  // Agenda closures contain "fechamento" too — classify before the journey
  // "Fechamento!" (início de tratamento) check below. "fora do horário" = aviso
  // de atendimento que extrapola o expediente (AJ2).
  if (
    t.includes("fechamento de agenda") ||
    t.includes("remarcar") ||
    t.includes("fora do horário")
  ) {
    return "agenda";
  }
  if (
    t.includes("fechamento") ||
    t.includes("início de tratamento") ||
    t.includes("iniciar tratamento")
  ) {
    return "inicio_tratamento";
  }
  if (t.includes("transferid") || t.includes("transfer")) return "transferencia";
  return "outras";
}
