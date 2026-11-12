// ASA2, entrega 3 (4007) — A RÉGUA DE AVISOS DO ASAAS (spec 17.3 a 17.5).
//
// Puro e testado: nada de rede, nada de banco. O servidor (`regua-servidor.ts`)
// lê a fila do banco, chama o Asaas e usa daqui: o celular, o pacote dos 8
// avisos e a estimativa de custo da tela.
import type { AsaasNotification, AvisoParaGravar } from "./api";

export type SlotDaRegua =
  | "criada"
  | "lembrete_1"
  | "lembrete_2"
  | "linha_digitavel"
  | "vencida_1"
  | "vencida_2"
  | "recebida"
  | "alterada";

/** Um aviso da régua da rede, como o banco devolve (`_gateway_regua_rules_json`). */
export type AvisoDaRegua = {
  slot: SlotDaRegua;
  event: string;
  scheduleOffset: number | null;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  phoneCall: boolean;
};

/** Os 8 avisos na ordem da tela, com o texto e os prazos que o Asaas aceita. */
export const AVISOS_DA_REGUA: {
  slot: SlotDaRegua;
  rotulo: string;
  explicacao: string;
  prazos: number[] | null;
  /** Como o prazo se lê: "dias antes" ou "dias depois". */
  sentido: "antes" | "depois" | null;
}[] = [
  { slot: "criada", rotulo: "Cobrança criada", explicacao: "Quando a cobrança é emitida, com o link para pagar.", prazos: null, sentido: null },
  { slot: "lembrete_1", rotulo: "Lembrete antes", explicacao: "Alguns dias antes do vencimento.", prazos: [5, 10, 15, 30], sentido: "antes" },
  // O Asaas deixa este FIXO no dia do vencimento (medido no sandbox, 12/11/2026).
  { slot: "lembrete_2", rotulo: "Lembrete no dia", explicacao: "No dia do vencimento (o Asaas não deixa mudar).", prazos: null, sentido: null },
  { slot: "linha_digitavel", rotulo: "Linha digitável", explicacao: "No dia do vencimento, só boleto, se o pagador ainda não abriu a fatura.", prazos: null, sentido: null },
  { slot: "vencida_1", rotulo: "Cobrança vencida", explicacao: "No dia seguinte ao vencimento sem pagamento.", prazos: null, sentido: null },
  { slot: "vencida_2", rotulo: "Vencida, novo aviso", explicacao: "Alguns dias depois do vencimento.", prazos: [1, 7, 15, 30], sentido: "depois" },
  { slot: "recebida", rotulo: "Pagamento recebido", explicacao: "A confirmação para o pagador.", prazos: null, sentido: null },
  { slot: "alterada", rotulo: "Cobrança alterada", explicacao: "Quando valor ou vencimento mudam.", prazos: null, sentido: null },
];

/**
 * Celular só quando parece celular: DDD + 9 + 8 dígitos (o mesmo
 * `_gateway_mobile` do banco). Aceita o 55 na frente.
 */
export function celularDoAsaas(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (/^55[1-9][1-9]9\d{8}$/.test(d)) return d.slice(2);
  if (/^[1-9][1-9]9\d{8}$/.test(d)) return d;
  return null;
}

export class ReguaIncompleta extends Error {
  readonly faltando: string[];
  constructor(faltando: string[]) {
    super(`avisos do Asaas faltando: ${faltando.join(", ")}`);
    this.faltando = faltando;
  }
}

/**
 * Casa os avisos do pagador no Asaas com os 8 da régua e monta o pacote do
 * `PUT /notifications/batch`.
 *
 * Os dois lembretes (`PAYMENT_DUEDATE_WARNING`) se distinguem pelo prazo: o
 * do dia é fixo em 0 no Asaas, o outro vai de 5 a 30. Os dois de vencida
 * (`PAYMENT_OVERDUE`): o de prazo 0 é o do dia, o outro vai de 1 a 30. Os
 * prazos nunca empatam, então a correspondência se mantém.
 *
 * D1: os avisos para a UNIDADE (`*EnabledForProvider`) vão sempre desligados.
 * Um aviso sem nenhum canal vai desligado (`enabled: false`).
 *
 * ⚠️ CANAL SÓ COM O CONTATO (provado no sandbox, 12/11/2026): o Asaas RECUSA
 * ligar o e-mail de um pagador sem e-mail ("Cliente não possui email para
 * contato"). Então e-mail só vai ligado com e-mail; SMS, WhatsApp e ligação só
 * com celular. Quando o contato chega na ficha, o pagador volta à fila.
 */
export function pacoteDosAvisos(
  doAsaas: AsaasNotification[],
  regua: AvisoDaRegua[],
  contato: { temEmail: boolean; temCelular: boolean }
): AvisoParaGravar[] {
  const vivos = doAsaas.filter((n) => n.id && !n.deleted);
  const doEvento = (e: string) => vivos.filter((n) => n.event === e);
  const prazo = (n: AsaasNotification) => Number(n.scheduleOffset ?? 0);
  const lembretes = [...doEvento("PAYMENT_DUEDATE_WARNING")].sort((a, b) => prazo(b) - prazo(a));
  const vencidas = [...doEvento("PAYMENT_OVERDUE")].sort((a, b) => prazo(a) - prazo(b));

  const alvo: Record<SlotDaRegua, AsaasNotification | undefined> = {
    criada: doEvento("PAYMENT_CREATED")[0],
    lembrete_1: lembretes[0],
    lembrete_2: lembretes[1],
    linha_digitavel: doEvento("SEND_LINHA_DIGITAVEL")[0],
    vencida_1: vencidas[0],
    vencida_2: vencidas[1],
    recebida: doEvento("PAYMENT_RECEIVED")[0],
    alterada: doEvento("PAYMENT_UPDATED")[0],
  };

  const faltando = regua.filter((r) => !alvo[r.slot]).map((r) => r.slot);
  if (faltando.length > 0) throw new ReguaIncompleta(faltando);

  return regua.map((r) => {
    const n = alvo[r.slot]!;
    const email = r.email && contato.temEmail;
    const sms = r.sms && contato.temCelular;
    const whatsapp = r.whatsapp && contato.temCelular;
    const ligacao = r.phoneCall && contato.temCelular;
    const item: AvisoParaGravar = {
      id: n.id as string,
      enabled: email || sms || whatsapp || ligacao,
      emailEnabledForProvider: false,
      smsEnabledForProvider: false,
      emailEnabledForCustomer: email,
      smsEnabledForCustomer: sms,
      phoneCallEnabledForCustomer: ligacao,
      whatsappEnabledForCustomer: whatsapp,
    };
    // Só os dois de prazo editável levam o prazo: o lembrete do dia e a vencida
    // do dia são fixos em 0 no Asaas (mandar o prazo neles é recusado).
    if ((r.slot === "lembrete_1" || r.slot === "vencida_2") && r.scheduleOffset != null) {
      item.scheduleOffset = r.scheduleOffset;
    }
    return item;
  });
}

// ---- o custo (ajuste 1 do dono, 12/11/2026) ------------------------------------

export type TarifasDeAviso = {
  mensageriaCents: number | null;
  whatsappCents: number | null;
  ligacaoCents: number | null;
};

export type EstimativaDoCusto = {
  /** E-mail e SMS: uma vez por cobrança paga, se algum aviso por e-mail ou SMS estiver ligado. */
  mensageria: { ligada: boolean; cobrancas: number; precoCents: number | null; totalCents: number | null };
  /** WhatsApp e ligação: a cada envio, paga ou não. */
  porDisparo: {
    whatsapp: { avisos: number; precoCents: number | null; totalCents: number | null };
    ligacao: { avisos: number; precoCents: number | null; totalCents: number | null };
    cobrancas: number;
    totalCents: number | null;
  };
};

const vezes = (preco: number | null, n: number) => (preco == null ? null : preco * n);

/**
 * A estimativa mensal da unidade. Mensageria: preço × cobranças PAGAS nos
 * últimos 30 dias, uma vez por cobrança. WhatsApp e ligação: preço × avisos
 * ligados naquele canal × cobranças EMITIDAS nos últimos 30 dias (é o teto:
 * os avisos de vencida só saem para quem não pagou).
 */
export function estimativaDoCusto(args: {
  regua: Pick<AvisoDaRegua, "email" | "sms" | "whatsapp" | "phoneCall">[];
  tarifas: TarifasDeAviso;
  emitidas30d: number;
  pagas30d: number;
}): EstimativaDoCusto {
  const { regua, tarifas } = args;
  const ligada = regua.some((r) => r.email || r.sms);
  const whats = regua.filter((r) => r.whatsapp).length;
  const lig = regua.filter((r) => r.phoneCall).length;
  const totalW = vezes(tarifas.whatsappCents, whats * args.emitidas30d);
  const totalL = vezes(tarifas.ligacaoCents, lig * args.emitidas30d);
  return {
    mensageria: {
      ligada,
      cobrancas: args.pagas30d,
      precoCents: tarifas.mensageriaCents,
      totalCents: ligada ? vezes(tarifas.mensageriaCents, args.pagas30d) : 0,
    },
    porDisparo: {
      whatsapp: { avisos: whats, precoCents: tarifas.whatsappCents, totalCents: whats === 0 ? 0 : totalW },
      ligacao: { avisos: lig, precoCents: tarifas.ligacaoCents, totalCents: lig === 0 ? 0 : totalL },
      cobrancas: args.emitidas30d,
      totalCents:
        (whats > 0 && totalW == null) || (lig > 0 && totalL == null) ? null : (whats === 0 ? 0 : totalW ?? 0) + (lig === 0 ? 0 : totalL ?? 0),
    },
  };
}

/** As tarifas de aviso da resposta de `GET /myAccount/fees`, em centavos. */
export function tarifasDeAvisoDoAsaas(fees: { notification?: { phoneCallFeeValue?: number | null; whatsAppFeeValue?: number | null; messagingFeeValue?: number | null } | null } | null | undefined): TarifasDeAviso {
  const c = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);
  return {
    mensageriaCents: c(fees?.notification?.messagingFeeValue),
    whatsappCents: c(fees?.notification?.whatsAppFeeValue),
    ligacaoCents: c(fees?.notification?.phoneCallFeeValue),
  };
}

/** O que mandar no `PUT /customers/{id}` em cada modo. Campo sem valor não vai (doc do Asaas). */
export function contatoParaOAsaas(
  modo: "on" | "off" | "clear",
  contato: { email: string | null; mobile: string | null }
): { body: { email?: string; mobilePhone?: string; notificationDisabled: boolean }; levouContato: boolean } {
  if (modo === "off") return { body: { notificationDisabled: true }, levouContato: false };
  if (modo === "clear") return { body: { email: "", mobilePhone: "", notificationDisabled: true }, levouContato: false };
  const body: { email?: string; mobilePhone?: string; notificationDisabled: boolean } = { notificationDisabled: false };
  if (contato.email) body.email = contato.email;
  const cel = celularDoAsaas(contato.mobile);
  if (cel) body.mobilePhone = cel;
  return { body, levouContato: !!(body.email || body.mobilePhone) };
}
