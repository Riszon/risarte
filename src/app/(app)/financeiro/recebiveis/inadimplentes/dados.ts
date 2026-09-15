import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarRecebiveis } from "../dados";
import {
  agruparInadimplentes,
  type CollectionOutcome,
  type Inadimplente,
  type UltimoContato,
} from "@/lib/finance/collection";

/**
 * A FILA DE COBRANÇA DA UNIDADE (relato OC-00009).
 *
 * ⚠️ REUSA `carregarRecebiveis`, e isso é a decisão principal deste arquivo.
 * A conta de multa, juros, benefício perdido e dias de atraso já mora em
 * `viewInstallment` — a mesma que a ficha do cliente e a tela de recebíveis
 * usam. Uma segunda consulta com uma segunda soma faria esta tela discordar
 * delas sobre a mesma dívida, e aí nenhum dos números valeria nada.
 *
 * O preço é buscar também as cobranças a vencer, que já vêm na mesma leitura.
 * Elas não são desperdício: entram como contexto da negociação ("além dos
 * R$ 800 vencidos, ainda tem R$ 2.400 a vencer").
 */

type ContatoBruto = {
  client_id: string;
  outcome: CollectionOutcome;
  note: string | null;
  promised_date: string | null;
  contacted_at: string;
  author_id: string | null;
};

export type FilaDeCobranca = {
  fila: Inadimplente[];
  /** Cobranças vencidas sem cliente vinculado — dívida sem para quem ligar. */
  semCliente: number;
  /** Erro ao ler os contatos (migração não aplicada, por exemplo). */
  contatosIndisponiveis: boolean;
};

export async function carregarFilaDeCobranca(
  supabase: SupabaseClient,
  clinicId: string
): Promise<FilaDeCobranca> {
  const { linhas } = await carregarRecebiveis(supabase, clinicId);

  const { data: contatoRows, error } = await supabase
    .from("collection_contacts")
    .select("client_id, outcome, note, promised_date, contacted_at, author_id")
    .eq("clinic_id", clinicId)
    .order("contacted_at", { ascending: false })
    .returns<ContatoBruto[]>();

  // ⚠️ RÉGUA VAZIA GRITA. Sem esta separação, a tabela ainda não criada neste
  // banco e "ninguém foi contatado ainda" produziriam a MESMA tela — e a
  // segunda leitura mandaria a equipe ligar para quem já foi atendido.
  const contatosIndisponiveis = Boolean(error);
  if (error) {
    console.error("cobrança: contatos indisponíveis:", error.message);
  }

  const autores = [
    ...new Set(
      (contatoRows ?? [])
        .map((c) => c.author_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const nomePorId = new Map<string, string>();
  if (autores.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", autores);
    for (const p of profs ?? []) {
      nomePorId.set(p.id, p.full_name || p.email || "—");
    }
  }

  // A consulta já vem do mais recente para o mais antigo: o primeiro de cada
  // cliente é o último contato.
  const porCliente = new Map<string, { ultimo: UltimoContato; total: number }>();
  for (const c of contatoRows ?? []) {
    const atual = porCliente.get(c.client_id);
    if (atual) {
      atual.total += 1;
      continue;
    }
    porCliente.set(c.client_id, {
      total: 1,
      ultimo: {
        outcome: c.outcome,
        note: c.note,
        promisedDate: c.promised_date,
        contactedAt: c.contacted_at,
        authorName: c.author_id ? nomePorId.get(c.author_id) ?? null : null,
      },
    });
  }

  const { fila, semCliente } = agruparInadimplentes(
    linhas.map((l) => ({
      clientId: l.clientId,
      cliente: l.cliente,
      telefone: l.telefone,
      isLate: l.isLate,
      daysLate: l.daysLate,
      balanceCents: l.balanceCents,
      updatedBalanceCents: l.updatedBalanceCents,
    })),
    porCliente
  );

  return { fila, semCliente, contatosIndisponiveis };
}

/** O histórico completo de contatos de UMA pessoa, para o diálogo. */
export async function carregarHistoricoDoCliente(
  supabase: SupabaseClient,
  clinicId: string,
  clientId: string
): Promise<UltimoContato[]> {
  const { data, error } = await supabase
    .from("collection_contacts")
    .select("outcome, note, promised_date, contacted_at, author_id")
    .eq("clinic_id", clinicId)
    .eq("client_id", clientId)
    .order("contacted_at", { ascending: false })
    .returns<Omit<ContatoBruto, "client_id">[]>();
  if (error) {
    console.error("histórico de cobrança:", error.message);
    return [];
  }

  const autores = [
    ...new Set(
      (data ?? []).map((c) => c.author_id).filter((x): x is string => Boolean(x))
    ),
  ];
  const nomePorId = new Map<string, string>();
  if (autores.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", autores);
    for (const p of profs ?? []) {
      nomePorId.set(p.id, p.full_name || p.email || "—");
    }
  }

  return (data ?? []).map((c) => ({
    outcome: c.outcome,
    note: c.note,
    promisedDate: c.promised_date,
    contactedAt: c.contacted_at,
    authorName: c.author_id ? nomePorId.get(c.author_id) ?? null : null,
  }));
}
