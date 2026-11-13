// A CENTRAL DE CONFIGURAÇÃO (ASA0) — as regras puras: quem abre, as abas, a
// lista de prontidão e a herança campo a campo. A barreira real é o banco
// (regras de linha de `gateway_accounts`, `central_can_see`, `gateway_can_link`
// e as funções da 4000 e da 4002); aqui é a tela (menu, botões, textos).
//
// ⚠️ TODA configuração comercial e financeira mora na Central (D19): cada fase
// ACRESCENTA a sua aba em `ABAS_DA_CENTRAL` — nenhuma cria tela à parte.

import { pode, type SessionContext } from "@/lib/auth";
import { canConfigureFinanceNetwork, canViewFinance } from "@/lib/finance/access";

// ---- quem abre -------------------------------------------------------------
//
// ⚠️ DESDE A ASA1 A CENTRAL ABRE POR ABA. Cada aba tem quem a vê, e a Central
// aparece para quem vê pelo menos uma:
//   * Conta e tarifas — `modulo.central` (nasce só com o Admin Master);
//   * Financeiro      — quem abria Financeiro › Configuração: a rede para quem
//                       configura a rede; a unidade para quem tem função nela;
//   * Comercial       — só o Admin Master (como Regras Comerciais sempre foi).

const temPapel = (session: SessionContext, papel: string, clinicId?: string) =>
  clinicId
    ? (session.rolesByClinic[clinicId] ?? []).some((r) => r === papel)
    : Object.values(session.rolesByClinic).some((papeis) => papeis.some((r) => r === papel));

/** A conta Asaas (aba Conta e tarifas) — `modulo.central`. */
export function podeVerContaAsaas(session: SessionContext): boolean {
  return pode(session, "modulo.central");
}

/** A conta Asaas do nível Rede: Admin Master e o Financeiro da Franqueadora. */
export function podeVerContaDaRede(session: SessionContext): boolean {
  if (!podeVerContaAsaas(session)) return false;
  return session.isAdminMaster || temPapel(session, "finance_franchisor");
}

/** A conta Asaas de uma unidade: quem vê a rede, e o Gerente da PRÓPRIA unidade. */
export function podeVerContaDaUnidade(session: SessionContext, clinicId: string): boolean {
  if (!podeVerContaAsaas(session)) return false;
  if (session.isAdminMaster || temPapel(session, "finance_franchisor")) return true;
  return temPapel(session, "unit_manager", clinicId);
}

/**
 * Quem pode colar a chave da conta Asaas desta unidade, pela TELA.
 * O Gerente precisa da permissão `acao.central.vincular_conta` na própria
 * unidade — e o BANCO ainda exige o termo de autorização registrado
 * (`gateway_can_link`). O Financeiro da Franqueadora não vincula (matriz 9.3).
 */
export function podeVincularContaPelaTela(session: SessionContext, clinicId: string | null): boolean {
  if (session.isAdminMaster) return true;
  if (!clinicId) return false;
  return temPapel(session, "unit_manager", clinicId) && pode(session, "acao.central.vincular_conta", clinicId);
}

/** A régua de avisos (aba Cobrança e comunicação): quem edita e liga as unidades. */
export function podeEditarRegua(session: SessionContext): boolean {
  return session.isAdminMaster || temPapel(session, "finance_franchisor");
}

// ---- as abas ------------------------------------------------------------------

export type NivelDaCentral = "rede" | "unidade";

export type AbaDaCentral = {
  id: string;
  rotulo: string;
  /** Uma frase que diz o que mora na aba. */
  descricao: string;
  niveis: NivelDaCentral[];
  /** A fase que entrega a aba (para o comentário e o teste). */
  fase: string;
};

/**
 * O REGISTRO DE ABAS. A ordem aqui é a ordem da tela.
 * ASA2 acrescenta `cobranca`; ASA3, `taxas`; ASA5, `empresarial`; ASA8,
 * `fiscal`. Aba nova = uma entrada aqui, um ramo em `podeVerAba` e um ramo em
 * `central_history` (banco).
 */
export const ABAS_DA_CENTRAL: AbaDaCentral[] = [
  {
    id: "conta",
    rotulo: "Conta e tarifas",
    descricao: "A conta Asaas, a chave de API (só gravação), o webhook e as tarifas por meio de pagamento.",
    niveis: ["rede", "unidade"],
    fase: "ASA0",
  },
  {
    id: "financeiro",
    rotulo: "Financeiro",
    descricao: "Multa, juros, arredondamento e os alertas do financeiro. A carência é fixa em zero.",
    niveis: ["rede", "unidade"],
    fase: "ASA1",
  },
  {
    id: "comercial",
    rotulo: "Comercial",
    descricao: "Desconto máximo e à vista, parcelamento, meios aceitos, parcela mínima, validade do orçamento e a cadência do follow-up.",
    niveis: ["rede", "unidade"],
    fase: "ASA1",
  },
  {
    id: "cobranca",
    rotulo: "Cobrança e comunicação",
    descricao: "A régua de avisos do Asaas ao pagador: avisos, prazos, canais, o custo e o botão de cada unidade.",
    niveis: ["rede", "unidade"],
    fase: "ASA2",
  },
  {
    id: "taxas",
    rotulo: "Taxas da franquia",
    descricao: "As taxas que a rede cobra das unidades, para onde vai cada uma no split, a tolerância e a multa e os juros da cobrança à unidade.",
    niveis: ["rede"],
    fase: "ASA3",
  },
];

export function abasDoNivel(nivel: NivelDaCentral): AbaDaCentral[] {
  return ABAS_DA_CENTRAL.filter((a) => a.niveis.includes(nivel));
}

export function abaValida(nivel: NivelDaCentral, id: string): AbaDaCentral | null {
  return abasDoNivel(nivel).find((a) => a.id === id) ?? null;
}

/** Esta pessoa vê esta aba, neste nível (e nesta unidade)? */
export function podeVerAba(
  session: SessionContext,
  aba: string,
  nivel: NivelDaCentral,
  clinicId?: string | null
): boolean {
  if (!abaValida(nivel, aba)) return false;
  if (nivel === "unidade" && !clinicId) return false;
  switch (aba) {
    case "conta":
      return nivel === "rede" ? podeVerContaDaRede(session) : podeVerContaDaUnidade(session, clinicId!);
    case "financeiro":
      if (canConfigureFinanceNetwork(session)) return true;
      // Gerente e Franqueado: só a configuração da própria unidade.
      return nivel === "unidade" && canViewFinance(session) && (session.rolesByClinic[clinicId!] ?? []).length > 0;
    case "comercial":
      return session.isAdminMaster;
    case "cobranca":
      // ASA2 (4007): editam o Admin Master e o Financeiro da Franqueadora; o
      // Gerente e o Franqueado veem a da própria unidade (o banco decide de novo).
      if (podeEditarRegua(session)) return true;
      return nivel === "unidade" && (temPapel(session, "unit_manager", clinicId!) || temPapel(session, "franchisee", clinicId!));
    case "taxas":
      // ASA3 (4008): quem configura a rede (Admin Master e Financeiro da
      // Franqueadora). Gerente e Franqueado continuam em Financeiro → Taxas da rede.
      return canConfigureFinanceNetwork(session);
    default:
      return false;
  }
}

/** As abas que esta pessoa vê, na ordem da tela. */
export function abasVisiveis(
  session: SessionContext,
  nivel: NivelDaCentral,
  clinicId?: string | null
): AbaDaCentral[] {
  return abasDoNivel(nivel).filter((a) => podeVerAba(session, a.id, nivel, clinicId));
}

/** O nível Rede aparece para quem vê pelo menos uma aba dele. */
export function podeVerRedeNaCentral(session: SessionContext): boolean {
  return abasVisiveis(session, "rede").length > 0;
}

/** Uma unidade aparece para quem vê pelo menos uma aba dela. */
export function podeVerUnidadeNaCentral(session: SessionContext, clinicId: string): boolean {
  return abasVisiveis(session, "unidade", clinicId).length > 0;
}

/**
 * A Central aparece no menu? Para quem vê pelo menos uma aba em algum lugar:
 * a conta Asaas (`modulo.central`), o Financeiro (quem tem o módulo) ou o
 * Comercial (Admin Master).
 */
export function podeVerCentral(session: SessionContext): boolean {
  return session.isAdminMaster || podeVerContaAsaas(session) || canViewFinance(session);
}

export const rotaDaRede = (aba = "conta") => `/central/rede/${aba}`;
export const rotaDaUnidade = (clinicId: string, aba = "conta") => `/central/unidades/${clinicId}/${aba}`;

/** A primeira aba que a pessoa vê (o destino de "abrir a unidade" ou "abrir a rede"). */
export function primeiraAba(session: SessionContext, nivel: NivelDaCentral, clinicId?: string | null): string | null {
  return abasVisiveis(session, nivel, clinicId)[0]?.id ?? null;
}

// ---- a prontidão ----------------------------------------------------------------

export type ItemDeProntidao = { item: string; ok: boolean; sort_order: number };

/** O que cada item quer dizer — e o que fazer quando falta. */
export const ITENS_DE_PRONTIDAO: Record<string, { rotulo: string; comoResolver: string }> = {
  conta_validada: {
    rotulo: "Conta Asaas validada",
    comoResolver: "Abra o cadastro da conta e grave a chave de API. Se já estava validada, use Verificar agora.",
  },
  wallet_id: {
    rotulo: "Identificador de carteira (walletId)",
    comoResolver: "Vem sozinho do Asaas quando a chave é gravada.",
  },
  webhook_ativo: {
    rotulo: "Webhook ativo",
    comoResolver: "É criado pelo riSZon ao gravar a chave. Se falhou, use Criar o webhook.",
  },
  tarifas: {
    rotulo: "Tarifas por meio de pagamento",
    comoResolver: "Vêm da consulta ao Asaas. Use Verificar agora para buscar de novo.",
  },
  chave_pix: {
    rotulo: "Chave Pix cadastrada na conta",
    comoResolver: "Cadastre uma chave Pix no painel do Asaas desta conta e use Verificar agora.",
  },
  split_habilitado: {
    rotulo: "Split habilitado no painel do Asaas",
    comoResolver: "No painel do Asaas: Integrações › Segurança › Habilitar Split. Depois, o Admin Master declara aqui.",
  },
  termo_registrado: {
    rotulo: "Termo de autorização do franqueado registrado",
    comoResolver: "O Admin Master registra a data e quem assinou o termo.",
  },
  antecipacao_desligada: {
    rotulo: "Antecipação automática desligada",
    comoResolver: "Desligue a antecipação automática no painel do Asaas desta conta e use Verificar agora.",
  },
};

export function rotuloDoItem(item: string): string {
  return ITENS_DE_PRONTIDAO[item]?.rotulo ?? item;
}

export type EstadoDaProntidao = "pronta" | "falta_marcar" | "faltam_itens" | "nao_conferida";

/**
 * Pronta = lista completa E marcada pelo Admin Master.
 * ⚠️ Lista VAZIA não é "nada falta": é "não consegui conferir" (o banco não
 * respondeu ou a migração não rodou). Zero itens nunca vira "pronta".
 */
export function estadoDaProntidao(itens: ItemDeProntidao[] | null | undefined, marcada: boolean): EstadoDaProntidao {
  if (!itens || itens.length === 0) return "nao_conferida";
  if (itens.some((i) => !i.ok)) return "faltam_itens";
  return marcada ? "pronta" : "falta_marcar";
}

export const ESTADO_DA_PRONTIDAO: Record<EstadoDaProntidao, { rotulo: string; tom: string }> = {
  pronta: {
    rotulo: "Pronta para cobrar",
    tom: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  falta_marcar: {
    rotulo: "Tudo conferido — falta o Admin Master marcar",
    tom: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  faltam_itens: {
    rotulo: "Ainda não pode cobrar",
    tom: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  },
  nao_conferida: { rotulo: "Não foi possível conferir", tom: "bg-muted text-muted-foreground" },
};

// A herança campo a campo mora em `heranca.ts` (puro, usado no navegador).
export { ORIGEM_DO_VALOR, valorEfetivo, type OrigemDoValor } from "./heranca";

// ---- a chave de API: o aviso do tempo sem uso ---------------------------------------

/**
 * O Asaas desativa a chave sem uso por 3 meses e a expira aos 6. A verificação
 * semanal já mantém a chave em uso; este aviso é a segunda rede, para quando
 * a verificação estiver parada. Devolve os dias sem uso a partir de 60, senão
 * nulo. `agora` e `ultimoUso` são instantes (ISO).
 */
export function diasSemUsoDaChave(ultimoUso: string | null | undefined, agora: Date = new Date()): number | null {
  if (!ultimoUso) return null;
  const t = new Date(ultimoUso).getTime();
  if (!Number.isFinite(t)) return null;
  const dias = Math.floor((agora.getTime() - t) / 86_400_000);
  return dias >= 60 ? dias : null;
}

// ---- a situação da conta no Asaas ----------------------------------------------------

export const SITUACAO_NO_ASAAS: Record<string, string> = {
  APPROVED: "aprovada",
  PENDING: "pendente",
  AWAITING_APPROVAL: "aguardando aprovação",
  REJECTED: "recusada",
};

export function situacaoNoAsaas(v: unknown): string {
  return typeof v === "string" && v ? (SITUACAO_NO_ASAAS[v] ?? v.toLowerCase()) : "sem informação";
}

export const ESTADO_DA_CONTA: Record<string, { rotulo: string; tom: string }> = {
  awaiting_key: { rotulo: "Aguardando a chave", tom: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  active: { rotulo: "Ativa", tom: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  error: { rotulo: "Com erro", tom: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
  disabled: { rotulo: "Desativada", tom: "bg-muted text-muted-foreground" },
};

/** O nome da modalidade de tarifa, como a equipe fala. */
export const MODALIDADE_DA_TARIFA: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  debito: "Cartão de débito",
  credito_avista: "Cartão de crédito à vista",
  credito_parcelado: "Cartão de crédito parcelado",
  recorrente: "Cartão recorrente",
  cartao_voucher: "Cartão voucher",
};
