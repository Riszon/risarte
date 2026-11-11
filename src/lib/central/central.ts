// A CENTRAL DE CONFIGURAÇÃO (ASA0) — as regras puras: quem abre, as abas, a
// lista de prontidão e a herança campo a campo. A barreira real é o banco
// (regras de linha de `gateway_accounts`, `central_can_see`, `gateway_can_link`
// e as funções da 4000 e da 4002); aqui é a tela (menu, botões, textos).
//
// ⚠️ TODA configuração comercial e financeira mora na Central (D19): cada fase
// ACRESCENTA a sua aba em `ABAS_DA_CENTRAL` — nenhuma cria tela à parte.

import { pode, type SessionContext } from "@/lib/auth";

// ---- quem abre -------------------------------------------------------------

/** A Central aparece no menu? (`modulo.central` nasce só com o Admin Master.) */
export function podeVerCentral(session: SessionContext): boolean {
  return pode(session, "modulo.central");
}

const temPapel = (session: SessionContext, papel: string, clinicId?: string) =>
  clinicId
    ? (session.rolesByClinic[clinicId] ?? []).some((r) => r === papel)
    : Object.values(session.rolesByClinic).some((papeis) => papeis.some((r) => r === papel));

/** O nível Rede: Admin Master e o Financeiro da Franqueadora. */
export function podeVerRedeNaCentral(session: SessionContext): boolean {
  if (!podeVerCentral(session)) return false;
  return session.isAdminMaster || temPapel(session, "finance_franchisor");
}

/** Uma unidade: quem vê a rede, e o Gerente da PRÓPRIA unidade. */
export function podeVerUnidadeNaCentral(session: SessionContext, clinicId: string): boolean {
  if (!podeVerCentral(session)) return false;
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
 * ASA1 acrescenta `financeiro` e `comercial`; ASA2, `cobranca`; ASA3,
 * `taxas`; ASA5, `empresarial`; ASA8, `fiscal`.
 */
export const ABAS_DA_CENTRAL: AbaDaCentral[] = [
  {
    id: "conta",
    rotulo: "Conta e tarifas",
    descricao: "A conta Asaas, a chave de API (só gravação), o webhook e as tarifas por meio de pagamento.",
    niveis: ["rede", "unidade"],
    fase: "ASA0",
  },
];

export function abasDoNivel(nivel: NivelDaCentral): AbaDaCentral[] {
  return ABAS_DA_CENTRAL.filter((a) => a.niveis.includes(nivel));
}

export function abaValida(nivel: NivelDaCentral, id: string): AbaDaCentral | null {
  return abasDoNivel(nivel).find((a) => a.id === id) ?? null;
}

export const rotaDaRede = (aba = "conta") => `/central/rede/${aba}`;
export const rotaDaUnidade = (clinicId: string, aba = "conta") => `/central/unidades/${clinicId}/${aba}`;

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

// ---- a herança campo a campo -------------------------------------------------------

export type OrigemDoValor = "herdado" | "personalizado" | "sem_valor";

/**
 * A regra de toda aba com dois níveis (o padrão já usado em `finance_settings`):
 * campo VAZIO na unidade herda o da rede. `null` e `undefined` são vazio; zero
 * e texto vazio digitado NÃO são (zero é um valor: "sem multa" é uma decisão).
 */
export function valorEfetivo<T>(
  daUnidade: T | null | undefined,
  daRede: T | null | undefined
): { valor: T | null; origem: OrigemDoValor } {
  if (daUnidade !== null && daUnidade !== undefined) return { valor: daUnidade, origem: "personalizado" };
  if (daRede !== null && daRede !== undefined) return { valor: daRede, origem: "herdado" };
  return { valor: null, origem: "sem_valor" };
}

export const ORIGEM_DO_VALOR: Record<OrigemDoValor, string> = {
  herdado: "herdado da rede",
  personalizado: "personalizado",
  sem_valor: "sem valor na rede",
};

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
