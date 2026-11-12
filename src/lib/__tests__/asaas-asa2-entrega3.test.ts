// ASA2, entrega 3 (4007) — a régua de avisos do Asaas e o comprovante. O que é
// do BANCO (a fila, quem lê, edita, declara, desliga e religa, o retrato da
// unidade, o histórico, o comprovante gravado pelo aviso) é provado pelo ensaio
// `scripts/asaas-ensaio-asa2-entrega3.mjs`, no treino; o que é do Asaas (os 8
// avisos, a gravação em lote, apagar o contato) pela prova sem envio
// `scripts/asaas-prova-regua-sandbox.mjs`. Aqui: as contas puras e as réguas
// que impedem a regressão no código.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionContext } from "@/lib/auth";
import { podeVerAba } from "@/lib/central/central";
import { matrizPadrao } from "@/lib/permissions";
import { mensagemDoComprovanteNoWhatsApp } from "@/lib/cobrancas";
import {
  AVISOS_DA_REGUA,
  ReguaIncompleta,
  celularDoAsaas,
  contatoParaOAsaas,
  estimativaDoCusto,
  pacoteDosAvisos,
  tarifasDeAvisoDoAsaas,
  type AvisoDaRegua,
} from "@/lib/asaas/regua";
import type { AsaasNotification } from "@/lib/asaas/api";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SQL = ler("supabase/migrations/4007_asa2_regua_de_avisos_do_asaas.sql");

function sessao(p: Partial<SessionContext>): SessionContext {
  return {
    userId: "u1",
    email: "x@example.com",
    fullName: "X",
    isAdminMaster: false,
    clinics: [],
    rolesByClinic: {},
    activeClinic: null,
    activeClinicExplicit: false,
    permissoes: matrizPadrao(),
    ...p,
  } as SessionContext;
}

/** Os 8 avisos padrão do Asaas, como o sandbox devolveu em 12/11/2026. */
const doAsaas = (): AsaasNotification[] =>
  [
    ["n1", "PAYMENT_CREATED", 0],
    ["n2", "PAYMENT_DUEDATE_WARNING", 0],
    ["n3", "PAYMENT_RECEIVED", 0],
    ["n4", "SEND_LINHA_DIGITAVEL", 0],
    ["n5", "PAYMENT_OVERDUE", 0],
    ["n6", "PAYMENT_OVERDUE", 7],
    ["n7", "PAYMENT_DUEDATE_WARNING", 10],
    ["n8", "PAYMENT_UPDATED", 0],
  ].map(([id, event, scheduleOffset]) => ({
    id: id as string,
    event: event as string,
    scheduleOffset: scheduleOffset as number,
    emailEnabledForProvider: true,
    smsEnabledForProvider: true,
    deleted: false,
  }));

/** A régua padrão do dono (D8). */
const D8: AvisoDaRegua[] = [
  { slot: "criada", event: "PAYMENT_CREATED", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "lembrete_1", event: "PAYMENT_DUEDATE_WARNING", scheduleOffset: 10, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "lembrete_2", event: "PAYMENT_DUEDATE_WARNING", scheduleOffset: 0, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "linha_digitavel", event: "SEND_LINHA_DIGITAVEL", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "vencida_1", event: "PAYMENT_OVERDUE", scheduleOffset: 0, email: true, sms: true, whatsapp: true, phoneCall: false },
  { slot: "vencida_2", event: "PAYMENT_OVERDUE", scheduleOffset: 7, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "recebida", event: "PAYMENT_RECEIVED", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
  { slot: "alterada", event: "PAYMENT_UPDATED", scheduleOffset: null, email: true, sms: true, whatsapp: false, phoneCall: false },
];

describe("o celular e o contato", () => {
  it("só celular de verdade vai ao Asaas (DDD + 9 + 8 dígitos)", () => {
    expect(celularDoAsaas("(43) 99999-8888")).toBe("43999998888");
    expect(celularDoAsaas("+55 43 99999-8888")).toBe("43999998888");
    expect(celularDoAsaas("(43) 3333-4444")).toBeNull();
    expect(celularDoAsaas("99999-8888")).toBeNull();
    expect(celularDoAsaas(null)).toBeNull();
  });
  it("o banco usa a mesma regra do celular", () => {
    expect(SQL).toMatch(/when d ~ '\^55\[1-9\]\[1-9\]9\[0-9\]\{8\}\$' then substr\(d, 3\)/);
    expect(SQL).toMatch(/when d ~ '\^\[1-9\]\[1-9\]9\[0-9\]\{8\}\$' then d/);
  });
  it("ligar manda o contato e liga os avisos; desligar só desliga; apagar deixa em branco (D6)", () => {
    expect(contatoParaOAsaas("on", { email: "a@b.com", mobile: "(43) 99999-8888" })).toEqual({
      body: { notificationDisabled: false, email: "a@b.com", mobilePhone: "43999998888" },
      levouContato: true,
    });
    expect(contatoParaOAsaas("on", { email: null, mobile: "4333334444" })).toEqual({ body: { notificationDisabled: false }, levouContato: false });
    expect(contatoParaOAsaas("off", { email: "a@b.com", mobile: "43999998888" })).toEqual({ body: { notificationDisabled: true }, levouContato: false });
    expect(contatoParaOAsaas("clear", { email: "a@b.com", mobile: null }).body).toEqual({ email: "", mobilePhone: "", notificationDisabled: true });
  });
});

describe("o pacote dos 8 avisos", () => {
  const cheio = { temEmail: true, temCelular: true };
  it("casa cada aviso pelo evento e pelo prazo (lembrete de maior prazo é o primeiro; vencida 0 é a do dia)", () => {
    const p = pacoteDosAvisos(doAsaas(), D8, cheio);
    const id = (slot: string) => p[D8.findIndex((r) => r.slot === slot)].id;
    expect(id("criada")).toBe("n1");
    expect(id("lembrete_1")).toBe("n7");
    expect(id("lembrete_2")).toBe("n2");
    expect(id("linha_digitavel")).toBe("n4");
    expect(id("vencida_1")).toBe("n5");
    expect(id("vencida_2")).toBe("n6");
    expect(id("recebida")).toBe("n3");
    expect(id("alterada")).toBe("n8");
  });
  it("D1: nunca liga aviso para a unidade, mesmo que o Asaas venha ligado", () => {
    for (const i of pacoteDosAvisos(doAsaas(), D8, cheio)) {
      expect(i.emailEnabledForProvider).toBe(false);
      expect(i.smsEnabledForProvider).toBe(false);
    }
  });
  it("só os avisos de prazo editável levam o prazo", () => {
    const p = pacoteDosAvisos(doAsaas(), D8, cheio);
    expect(p.filter((i) => "scheduleOffset" in i).map((i) => i.id).sort()).toEqual(["n2", "n6", "n7"]);
  });
  it("canal só com o contato: sem e-mail, e-mail desligado; sem celular, SMS e WhatsApp desligados (o Asaas recusa)", () => {
    const semEmail = pacoteDosAvisos(doAsaas(), D8, { temEmail: false, temCelular: true });
    expect(semEmail.every((i) => !i.emailEnabledForCustomer)).toBe(true);
    expect(semEmail.some((i) => i.smsEnabledForCustomer)).toBe(true);
    const semCel = pacoteDosAvisos(doAsaas(), D8, { temEmail: true, temCelular: false });
    expect(semCel.every((i) => !i.smsEnabledForCustomer && !i.whatsappEnabledForCustomer && !i.phoneCallEnabledForCustomer)).toBe(true);
    const nada = pacoteDosAvisos(doAsaas(), D8, { temEmail: false, temCelular: false });
    expect(nada.every((i) => i.enabled === false)).toBe(true);
  });
  it("aviso sem canal vai desligado; WhatsApp só no aviso do dia da vencida (D8)", () => {
    const r = D8.map((x) => (x.slot === "alterada" ? { ...x, email: false, sms: false } : x));
    const p = pacoteDosAvisos(doAsaas(), r, cheio);
    expect(p.find((i) => i.id === "n8")?.enabled).toBe(false);
    expect(p.filter((i) => i.whatsappEnabledForCustomer).map((i) => i.id)).toEqual(["n5"]);
  });
  it("faltando aviso no Asaas, não grava pela metade", () => {
    expect(() => pacoteDosAvisos(doAsaas().filter((n) => n.id !== "n6"), D8, cheio)).toThrow(ReguaIncompleta);
  });
  it("aviso apagado no Asaas não conta", () => {
    const lista = doAsaas().map((n) => (n.id === "n3" ? { ...n, deleted: true } : n));
    expect(() => pacoteDosAvisos(lista, D8, cheio)).toThrow(ReguaIncompleta);
  });
});

describe("o custo (ajuste 1)", () => {
  const tarifas = { mensageriaCents: 99, whatsappCents: 55, ligacaoCents: 55 };
  it("mensageria: uma vez por cobrança PAGA, se houver e-mail ou SMS ligado", () => {
    const e = estimativaDoCusto({ regua: D8, tarifas, emitidas30d: 40, pagas30d: 30 });
    expect(e.mensageria).toEqual({ ligada: true, cobrancas: 30, precoCents: 99, totalCents: 2970 });
  });
  it("WhatsApp e ligação: por envio × avisos ligados × cobranças emitidas", () => {
    const r = D8.map((x) => (x.slot === "vencida_2" ? { ...x, phoneCall: true } : x));
    const e = estimativaDoCusto({ regua: r, tarifas, emitidas30d: 40, pagas30d: 30 });
    expect(e.porDisparo.whatsapp).toEqual({ avisos: 1, precoCents: 55, totalCents: 2200 });
    expect(e.porDisparo.ligacao).toEqual({ avisos: 1, precoCents: 55, totalCents: 2200 });
    expect(e.porDisparo.totalCents).toBe(4400);
  });
  it("sem e-mail nem SMS na régua, não há mensageria", () => {
    const r = D8.map((x) => ({ ...x, email: false, sms: false }));
    expect(estimativaDoCusto({ regua: r, tarifas, emitidas30d: 40, pagas30d: 30 }).mensageria.totalCents).toBe(0);
  });
  it("preço desconhecido fica desconhecido (não vira zero)", () => {
    const e = estimativaDoCusto({ regua: D8, tarifas: { mensageriaCents: null, whatsappCents: null, ligacaoCents: 55 }, emitidas30d: 10, pagas30d: 5 });
    expect(e.mensageria.totalCents).toBeNull();
    expect(e.porDisparo.totalCents).toBeNull();
  });
  it("as tarifas de aviso vêm de GET /myAccount/fees", () => {
    expect(tarifasDeAvisoDoAsaas({ notification: { messagingFeeValue: 0.99, whatsAppFeeValue: 0.55, phoneCallFeeValue: 0.55 } })).toEqual({
      mensageriaCents: 99,
      whatsappCents: 55,
      ligacaoCents: 55,
    });
    expect(tarifasDeAvisoDoAsaas(null)).toEqual({ mensageriaCents: null, whatsappCents: null, ligacaoCents: null });
  });
});

describe("as regras no banco e no código", () => {
  it("a régua nasce com o padrão do dono (D8) e nenhuma unidade ligada", () => {
    expect(SQL).toMatch(/\('vencida_1',\s+'PAYMENT_OVERDUE',\s+0,\s+true, true, true,\s+false, 5\)/);
    const semWhats = ["criada", "lembrete_1", "lembrete_2", "linha_digitavel", "vencida_2", "recebida", "alterada"];
    for (const s of semWhats) expect(SQL, s).toMatch(new RegExp(`\\('${s}',[^)]*true, true, false, false, \\d\\)`));
    expect(SQL).toMatch(/enabled boolean not null default false/);
  });
  it("D7: desligar — Recepção, Gerente, Financeiro e Admin; religar — sem a Recepção", () => {
    expect(SQL).toMatch(/case when p_reenable then array\['unit_manager'\]::public\.user_role\[\]\s+else array\['unit_manager', 'receptionist'\]::public\.user_role\[\] end/);
  });
  it("a régua só liga depois da declaração do termo, que é do Admin Master", () => {
    expect(SQL).toMatch(/raise exception 'PRIVACY_NOT_DECLARED'/);
    const decl = SQL.slice(SQL.indexOf("create or replace function public.gateway_regua_declare_privacy"));
    expect(decl.slice(0, decl.indexOf("$$;"))).toMatch(/if not public\.is_admin_master\(\) then raise exception 'NOT_ALLOWED'/);
  });
  it("toda função interna nova responde só à chave de serviço; as portas têm grant", () => {
    const internas = [...SQL.matchAll(/create or replace function public\.(_[a-z_]+)\(/g)].map((m) => m[1]);
    expect(internas.length).toBeGreaterThanOrEqual(15);
    for (const f of new Set(internas)) {
      expect(SQL, f).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQL, f).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
    for (const f of ["gateway_regua_read", "gateway_regua_save", "gateway_regua_declare_privacy", "gateway_regua_unit_set", "gateway_regua_unit_overview", "gateway_optout_status", "gateway_optout_set"]) {
      expect(SQL, f).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated;`));
    }
  });
  it("a régua é aplicada ANTES da cobrança nascer (para o aviso 'cobrança criada' sair)", () => {
    const emissao = ler("src/lib/asaas/cobranca.ts");
    const regua = emissao.indexOf("banco.aplicarRegua(pagador.localId)");
    const cria = emissao.indexOf("pagamento = await createPayment(");
    expect(regua).toBeGreaterThan(0);
    expect(regua).toBeLessThan(cria);
  });
  it("a fila roda a cada 10 minutos e não insiste no 429 dentro da rodada", () => {
    expect(ler("vercel.json")).toMatch(/"path": "\/api\/cron\/gateway-regua", "schedule": "\*\/10 \* \* \* \*"/);
    expect(ler("src/lib/asaas/regua-servidor.ts")).toMatch(/rateLimitRetries: 0/);
  });
  it("a cota: 50 pagadores × 3 chamadas × 6 rodadas/h × 12 h cabe nas 25.000 por conta", () => {
    const src = ler("src/lib/asaas/regua-servidor.ts");
    const n = Number(/PAGADORES_POR_CONTA = (\d+)/.exec(src)?.[1]);
    expect(n * 3 * 6 * 12).toBeLessThan(25000 / 2);
  });
  it("a aba Cobrança e comunicação: edita Admin e Financeiro; vê o Gerente e o Franqueado da própria unidade", () => {
    const gerente = sessao({ rolesByClinic: { a: ["unit_manager"] } });
    expect(podeVerAba(gerente, "cobranca", "unidade", "a")).toBe(true);
    expect(podeVerAba(gerente, "cobranca", "unidade", "b")).toBe(false);
    expect(podeVerAba(gerente, "cobranca", "rede")).toBe(false);
    expect(podeVerAba(sessao({ rolesByClinic: { a: ["franchisee"] } }), "cobranca", "unidade", "a")).toBe(true);
    expect(podeVerAba(sessao({ rolesByClinic: { f: ["finance_franchisor"] } }), "cobranca", "rede")).toBe(true);
    for (const papel of ["receptionist", "dentist", "asb", "tsb", "commercial_consultant"] as const) {
      expect(podeVerAba(sessao({ rolesByClinic: { a: [papel] } }), "cobranca", "unidade", "a"), papel).toBe(false);
    }
  });
  it("os 8 avisos da tela batem com os da régua do banco", () => {
    const slots = AVISOS_DA_REGUA.map((a) => a.slot);
    expect(slots).toHaveLength(8);
    for (const s of slots) expect(SQL).toMatch(new RegExp(`\\('${s}',`));
  });
});

describe("o comprovante (ajuste 4)", () => {
  it("a mensagem leva o link e o primeiro nome, sem CPF", () => {
    const m = mensagemDoComprovanteNoWhatsApp({ nomeDoPagador: "Maria Souza", valorFormatado: "R$ 10,00", link: "https://x/c" });
    expect(m).toMatch(/^Olá, Maria! Recebemos o pagamento de R\$ 10,00/);
    expect(m).toContain("https://x/c");
  });
  it("o comprovante vem do aviso de pagamento e só aceita https", () => {
    expect(SQL).toMatch(/transactionReceiptUrl/);
    expect(SQL).toMatch(/v_url !~ '\^https:\/\/'/);
  });
  it("a ficha mostra 'Ver comprovante' e 'Enviar comprovante pelo WhatsApp' na cobrança paga", () => {
    const card = ler("src/app/(app)/prontuarios/[id]/cobranca-da-parcela.tsx");
    expect(card).toMatch(/Ver comprovante/);
    expect(card).toMatch(/Enviar comprovante pelo WhatsApp/);
  });
});
