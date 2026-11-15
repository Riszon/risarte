// ASA4, 1B (4015) — a forma 2, "Todos os boletos agora": o que não depende do
// banco. O banco é provado no ensaio (scripts/asaas-ensaio-asa4-1b.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mensagemDaLista, textosDaForma } from "@/lib/asaas/forma-dos-boletos";
import { comConfirmacaoDeBoletos } from "@/lib/confirmar-boletos";
import { ehCadastroAuxiliar } from "@/lib/asaas/api";

const SQL = readFileSync("supabase/migrations/4015_asa4_forma2_todos_os_boletos_agora.sql", "utf8");
const OP = readFileSync("src/lib/asaas/boletos-da-operacao.ts", "utf8");
const COBRANCA = readFileSync("src/lib/asaas/cobranca.ts", "utf8");
const REGUA = readFileSync("src/lib/asaas/regua-servidor.ts", "utf8");
const PAGINA = readFileSync("src/app/boletos/[token]/page.tsx", "utf8");
const CONFIG = readFileSync("next.config.ts", "utf8");
const PROXY = readFileSync("src/proxy.ts", "utf8");
const BAIXA = readFileSync("src/app/(app)/prontuarios/[id]/receivables-actions.ts", "utf8");
const CANCEL = readFileSync("src/app/(app)/apresentacao/[clientId]/cancellation-actions.ts", "utf8");
const PARC = readFileSync("src/app/(app)/comercial/payment-schedule-actions.ts", "utf8");

describe("a escolha da forma (19.9 acréscimo A)", () => {
  it("os textos do Jeferson, com o prazo da rede", () => {
    const t = textosDaForma(15);
    expect(t.mensal.paraQuemFecha).toContain("cerca de 15 dias antes de cada vencimento");
    expect(t.todos.paraQuemFecha).toContain("será preciso cancelar os boletos em aberto");
    expect(t.todos.paraOCliente).toBe("Você recebe hoje todos os boletos do seu tratamento, de uma vez. Perto de cada vencimento, enviamos um lembrete.");
    expect(textosDaForma(20).mensal.paraOCliente).toContain("cerca de 20 dias");
  });
  it("só com a unidade ligada e só se houver boleto (4a); na auditoria", () => {
    expect(SQL).toContain("raise exception 'UNIT_NOT_ON'");
    expect(SQL).toContain("raise exception 'NO_BOLETO'");
    expect(SQL).toContain("'sale_boleto_mode'");
  });
  it("de 2 para 1: só os boletos do carnê que vencem fora do prazo (1a)", () => {
    expect(SQL).toContain("and c.due_date > public.today_br() + public._auto_charge_window()");
  });
});

describe("o cadastro do carnê", () => {
  it("o boleto da forma 2 sai pelo carnê, e o carnê nunca é o pagador da régua", () => {
    expect(SQL).toContain("v.billing_type = 'BOLETO' and public._sale_boleto_mode(");
    expect(COBRANCA).toContain("const cliente = c.via_carne ? await cadastroDoCarne(c, pagador.localId, cred, opts) : pagador.asaasId;");
    expect(ehCadastroAuxiliar("riszon-carne:abc")).toBe(true);
    expect(ehCadastroAuxiliar("riszon-parcelado:abc")).toBe(true);
    expect(ehCadastroAuxiliar("outra")).toBe(false);
  });
  it("a régua aplica o mesmo contato nos dois cadastros, com o \"cobrança criada\" desligado no carnê", () => {
    expect(REGUA).toContain('r.slot === "criada" ? { ...r, email: false, sms: false, whatsapp: false, phoneCall: false } : r');
    expect(REGUA.match(/updateCustomer\(/g)?.length).toBe(1);
  });
});

describe("boleto que deixa de valer (19.26.1)", () => {
  it("a operação tenta primeiro (a permissão é a dela) e só cancela se parou na trava", () => {
    expect(OP).toContain("const TRAVA = /CHARGE_ACTIVE|CHARGE_IN_GATEWAY/;");
    expect(OP).toContain("if (!TRAVA.test(primeira.error.message))");
    expect(OP).toContain("if (!args.confirmar) return { ok: false, error: textoDaConfirmacao(vivos.length), precisaConfirmar: vivos.length };");
  });
  it("primeiro o Asaas, e boleto já pago para tudo", () => {
    expect(OP).toContain("if (p?.status && PAGA_NO_ASAAS.has(p.status))");
    expect(OP).toContain('_charge_mark_cancelled_system');
  });
  it("falha depois de cancelar vira pendência com aviso (19.27 ponto 1)", () => {
    expect(OP).toContain("await registrarFalha(args, vivos[0], cancelados, segunda.error.message);");
    expect(SQL).toContain("'Operação interrompida: boleto cancelado sem a mudança'");
  });
  it("as cinco operações passam pelo cancelamento na mesma operação", () => {
    // 4017: a renegociação cancela os boletos na ASSINATURA (src/lib/asaas/renegociacao.ts).
    expect(readFileSync("src/lib/asaas/renegociacao.ts", "utf8")).toContain('operacao: "renegociação"');
    expect(BAIXA).toContain('quitaMenor ? "quitação por valor menor"');
    expect(CANCEL).toContain('operacao: "cancelamento do plano"');
    expect(PARC).toContain('operacao: "alteração do parcelamento"');
  });
  it("o cancelamento da operação não conta como à mão", () => {
    expect(SQL).toContain("and not c.cancel_system");
  });
  it("o pagamento de boleto cancelado alerta o Gerente e o Financeiro, com valor e parcela", () => {
    expect(SQL).toContain("'Pagaram um boleto que o riSZon tinha cancelado'");
    expect(SQL).toContain("'O Asaas restaurou um boleto que o riSZon tinha cancelado'");
  });
});

describe("a confirmação antes de cancelar (19.27 ponto 3)", () => {
  it("pergunta com o texto, e sem o sim nada muda", async () => {
    let chamadas: boolean[] = [];
    const fazer = async (confirmar: boolean) => {
      chamadas.push(confirmar);
      return confirmar ? { ok: true } : { ok: false, error: "Esta operação cancela 3 boletos já entregues ao cliente.", precisaConfirmar: 3 };
    };
    let perguntado = "";
    const r = await comConfirmacaoDeBoletos(fazer, (t) => ((perguntado = t), true));
    expect(r.ok).toBe(true);
    expect(perguntado).toContain("cancela 3 boletos já entregues ao cliente");
    expect(chamadas).toEqual([false, true]);
    chamadas = [];
    const n = await comConfirmacaoDeBoletos(fazer, () => false);
    expect(n.ok).toBe(false);
    expect(n.error).toContain("continuam valendo");
    expect(chamadas).toEqual([false]);
  });
});

describe("a página da lista (19.26.3)", () => {
  it("só o resumo do código; acesso registrado; limite; revogação", () => {
    expect(PAGINA).toContain('createHash("sha256").update(token).digest("hex")');
    expect(SQL).toContain("insert into public.boleto_list_accesses (list_id, ip_hash, user_agent)");
    expect(SQL).toContain(">= 20 then");
    expect(SQL).toContain(">= 60 then");
    expect(SQL).toContain("if l.revoked_at is not null or l.expires_at < public.today_br() then");
  });
  it("fora dos buscadores, sem cache, sem passar o endereço adiante; pública sem login", () => {
    expect(PAGINA).toContain("robots: { index: false, follow: false, nocache: true }");
    expect(CONFIG).toContain('{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }');
    expect(CONFIG).toContain('{ key: "Cache-Control", value: "no-store, max-age=0" }');
    expect(CONFIG).toContain('{ key: "Referrer-Policy", value: "no-referrer" }');
    expect(PROXY).toContain('"/boletos/"');
  });
  it("só os dados mínimos: primeiro nome; sem CPF", () => {
    expect(SQL).toContain("split_part(btrim(c.full_name), ' ', 1)");
    expect(SQL).not.toMatch(/'cpf'/);
  });
  it("a mensagem do WhatsApp leva só o primeiro nome e o link", () => {
    expect(mensagemDaLista("Ana", "https://x/boletos/abc")).toBe("Olá, Ana! Seguem todos os boletos do seu tratamento: https://x/boletos/abc . Perto de cada vencimento, enviamos um lembrete.");
  });
  it("o acesso à lista conta como \"aberta\" (o alerta de não abriu — 19.26.4)", () => {
    expect(SQL).toContain("update public.charges c set viewed_at = coalesce(c.viewed_at, now())");
  });
});
