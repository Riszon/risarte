// 4012 (spec 19.3): as Cobranças da venda — tipos e textos puros.

export type CobrancaDaParcela = {
  id: string;
  status: string;
  meio: string;
  valor: number;
  link: string | null;
  boleto: string | null;
  pix: string | null;
  linha: string | null;
  criada_em: string | null;
  origem: string | null;
  enviada_pelo_asaas_em: string | null;
  aberta_em: string | null;
  paga_em: string | null;
};

export type ParcelaDaVenda = {
  installment_id: string;
  seq: number;
  tipo: string;
  vencimento: string;
  valor: number;
  pago: number;
  meio: string | null;
  situacao_parcela: string;
  pelo_asaas: boolean;
  agendada_para: string | null;
  cobranca: CobrancaDaParcela | null;
  ultimo_envio: { canal: string; quem: string | null; quando: string } | null;
};

export type CobrancasDaVenda = {
  automatica: boolean;
  prazo: number;
  venda_fechada_em: string | null;
  parcelas: ParcelaDaVenda[];
};

const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

/** A situação de cada parcela na linguagem da tela (19.3). */
export function situacaoDaParcela(p: ParcelaDaVenda): { rotulo: string; tom: "neutro" | "aguardando" | "paga" | "vencida" | "erro" } {
  if (p.situacao_parcela === "paga") return { rotulo: "Paga", tom: "paga" };
  if (p.situacao_parcela === "cancelada" || p.situacao_parcela === "renegociada") return { rotulo: "Cancelada", tom: "neutro" };
  const c = p.cobranca;
  if (!c) {
    if (!p.pelo_asaas) return { rotulo: "Fora do Asaas (balcão)", tom: "neutro" };
    return p.agendada_para ? { rotulo: `Agendada para ${dm(p.agendada_para)}`, tom: "neutro" } : { rotulo: "Sem cobrança", tom: "neutro" };
  }
  if (c.status === "paga" || c.status === "liquidada") return { rotulo: "Paga", tom: "paga" };
  if (c.status === "vencida") return { rotulo: "Vencida", tom: "vencida" };
  if (c.status === "erro_emissao") return { rotulo: "Erro ao criar no Asaas", tom: "erro" };
  if (c.status === "emitindo") return { rotulo: "Sendo criada", tom: "aguardando" };
  if (c.status === "externa") return { rotulo: "Cobrada fora do riSZon", tom: "neutro" };
  return { rotulo: "Aguardando pagamento", tom: "aguardando" };
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const CANAL: Record<string, string> = {
  copiar_link: "link copiado",
  whatsapp: "WhatsApp",
  copiar_pix: "Pix copiado",
  linha_digitavel: "linha digitável copiada",
};

/** As linhas de envio: Asaas (não é confirmação de entrega), riSZon e abertura. */
export function linhasDeEnvio(p: ParcelaDaVenda): string[] {
  const out: string[] = [];
  const c = p.cobranca;
  if (!c) return out;
  if (c.enviada_pelo_asaas_em) out.push(`Enviada pelo Asaas (e-mail/SMS) em ${quando(c.enviada_pelo_asaas_em)} — não é confirmação de entrega`);
  if (p.ultimo_envio)
    out.push(`Enviada pelo riSZon por ${p.ultimo_envio.quem ?? "—"} (${CANAL[p.ultimo_envio.canal] ?? p.ultimo_envio.canal}) em ${quando(p.ultimo_envio.quando)}`);
  if (c.aberta_em) out.push(`Aberta pelo pagador em ${quando(c.aberta_em)}`);
  if (!c.enviada_pelo_asaas_em && !p.ultimo_envio && ["emitida", "vencida"].includes(c.status)) out.push("Link ainda não enviado");
  return out;
}

/** A mensagem pronta do WhatsApp (o paciente abre o link do Asaas). */
export function mensagemDoWhatsApp(p: ParcelaDaVenda): string {
  const valor = ((p.cobranca?.valor ?? p.valor) / 100).toFixed(2).replace(".", ",");
  return `Olá! Segue o link da sua parcela de R$ ${valor}, com vencimento em ${dm(p.vencimento)}: ${p.cobranca?.link ?? ""}`;
}
