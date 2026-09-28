// Indica +Risos — metas da EQUIPE (IND4). Espelho puro do que `apurar_meta` e
// `aprovar_apuracao` fazem no banco, para a tela mostrar e pré-conferir.
// As faixas vêm da configuração (`metas_faixas_padrao`) — nada fixo aqui.

export const PREMIO_TIPOS = ["dinheiro", "voucher", "experiencia"] as const;
export type PremioTipo = (typeof PREMIO_TIPOS)[number];
export const PREMIO_TIPO_LABEL: Record<PremioTipo, string> = {
  dinheiro: "Dinheiro (folha)",
  voucher: "Voucher",
  experiencia: "Experiência da equipe",
};

export const GRUPOS_PREMIO = ["recepcao_crc", "demais"] as const;
export type GrupoPremio = (typeof GRUPOS_PREMIO)[number];
export const GRUPO_PREMIO_LABEL: Record<GrupoPremio, string> = {
  recepcao_crc: "Recepção / CRC",
  demais: "Demais funções",
};

export const METRICAS = ["conversoes", "riso_coins", "receita_indicados"] as const;
export type Metrica = (typeof METRICAS)[number];
export const METRICA_LABEL: Record<Metrica, string> = {
  conversoes: "Conversões",
  riso_coins: "Riso Coins gerados",
  receita_indicados: "Receita dos indicados",
};

export const APURACAO_STATUS_LABEL: Record<string, string> = {
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  reprovada: "Reprovada",
  paga: "Paga",
};

export type Premio = { tipo: PremioTipo; valor_centavos: number; descricao?: string };
export type Faixa = { nome: string; gatilho: number; premios: Record<GrupoPremio, Premio> };

/** Confere as faixas antes de gravar: nome, gatilho crescente, prêmio válido. */
export function validarFaixas(faixas: Faixa[]): string | null {
  if (faixas.length === 0) return "A meta precisa de pelo menos uma faixa.";
  const nomes = new Set<string>();
  let anterior = -Infinity;
  for (const f of faixas) {
    if (!f.nome.trim()) return "Toda faixa precisa de nome.";
    if (nomes.has(f.nome.trim())) return `Faixa "${f.nome}" repetida.`;
    nomes.add(f.nome.trim());
    if (!(Number.isFinite(f.gatilho) && f.gatilho > 0)) return `Faixa "${f.nome}": o gatilho precisa ser maior que zero.`;
    if (f.gatilho <= anterior) return "Os gatilhos das faixas precisam ser crescentes.";
    anterior = f.gatilho;
    for (const g of GRUPOS_PREMIO) {
      const p = f.premios?.[g];
      if (!p || !PREMIO_TIPOS.includes(p.tipo)) return `Faixa "${f.nome}": escolha o prêmio de ${GRUPO_PREMIO_LABEL[g]}.`;
      if (!(Number.isInteger(p.valor_centavos) && p.valor_centavos >= 0)) {
        return `Faixa "${f.nome}": valor do prêmio de ${GRUPO_PREMIO_LABEL[g]} inválido.`;
      }
    }
  }
  return null;
}

/** Espelho do banco: a MAIOR faixa cujo gatilho foi alcançado. */
export function faixaAtingida(faixas: Faixa[], valor: number): Faixa | null {
  return [...faixas].sort((a, b) => b.gatilho - a.gatilho).find((f) => f.gatilho <= valor) ?? null;
}

/** Próxima faixa e quanto falta — o que motiva a equipe no meio do mês. */
export function proximaFaixa(faixas: Faixa[], valor: number): { faixa: Faixa; falta: number } | null {
  const f = [...faixas].sort((a, b) => a.gatilho - b.gatilho).find((x) => x.gatilho > valor);
  return f ? { faixa: f, falta: f.gatilho - valor } : null;
}

export type PremioApurado = {
  user_id: string;
  nome: string;
  funcao: string;
  grupo: GrupoPremio;
  premio: Premio | null;
};

/** Totais do relatório para a folha: dinheiro separado de voucher/experiência. */
export function totaisDaFolha(premios: PremioApurado[]) {
  let dinheiroCentavos = 0;
  let vouchers = 0;
  let voucherCentavos = 0;
  let experiencias = 0;
  for (const p of premios) {
    if (!p.premio) continue;
    if (p.premio.tipo === "dinheiro") dinheiroCentavos += p.premio.valor_centavos;
    else if (p.premio.tipo === "voucher") {
      vouchers++;
      voucherCentavos += p.premio.valor_centavos;
    } else experiencias++;
  }
  return { dinheiroCentavos, vouchers, voucherCentavos, experiencias };
}
