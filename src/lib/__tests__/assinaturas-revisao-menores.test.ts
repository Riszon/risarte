import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unidadeDoEnvio } from "@/lib/signatures/unidade-do-envio";
import { modoDeAutenticacao } from "@/lib/signatures/auth-level";
import { semDadoPessoal } from "@/lib/zapsign/client";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { mesDoConsumo } from "@/lib/signatures/send";

// AP158 — os achados menores da revisão da assinatura digital (11/11/2026).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const A = "src/app/(app)/assinaturas/";

describe("item 1 — a assinatura sai pela unidade do paciente", () => {
  it("unidade ativa vale só se for a de cadastro ou a preferida", () => {
    expect(unidadeDoEnvio({ ativa: "casa", cadastro: "casa", preferida: null })).toBe("casa");
    expect(unidadeDoEnvio({ ativa: "pref", cadastro: "casa", preferida: "pref" })).toBe("pref");
    expect(unidadeDoEnvio({ ativa: "compartilhada", cadastro: "casa", preferida: "pref" })).toBe("pref");
    expect(unidadeDoEnvio({ ativa: "compartilhada", cadastro: "casa", preferida: null })).toBe("casa");
    expect(unidadeDoEnvio({ ativa: null, cadastro: "casa", preferida: null })).toBe("casa");
  });

  it("a ficha usa essa unidade nos três botões e nas permissões", () => {
    const s = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(s).toContain("canSendSignatures(session, signatureClinicId)");
    expect(s).toContain("canViewSignaturePackages(session, signatureClinicId)");
    expect(s.match(/clinicId=\{signatureClinicId\}/g)?.length).toBe(3);
    expect(s).not.toMatch(/<EnviarParaAssinaturaDialog\s+clientId=\{client\.id\}\s+clinicId=\{scheduleClinicId\}/);
  });
});

describe("item 2 — o pacote pergunta ao banco", () => {
  it("lista, detalhe e ações usam signature_can", () => {
    expect(ler(A + "lista-de-pacotes.tsx")).toContain("permissoesPorUnidade(supabase)");
    expect(ler(A + "pacotes/[id]/page.tsx")).toContain("await permissoesNoBanco(supabase, pkg.clinic_id)");
    const p = ler("src/lib/signatures/pacote.ts");
    expect(p).not.toMatch(/can(View|Download|Send|Cancel)Signature/);
    for (const cap of ["visualizar", "baixar", "enviar", "cancelar"]) expect(p).toContain(`"acao.assinaturas.${cap}"`);
    expect(ler("src/lib/signatures/reenvio.ts")).toContain('podeNoBanco(supabase, "acao.assinaturas.enviar", old.clinic_id)');
    expect(ler("src/lib/signatures/acesso-no-banco.ts")).toContain('"acao.assinaturas.painel_rede"');
  });
});

describe("item 3 — o painel da unidade só com as unidades do painel", () => {
  it("as três leituras passam o alcance, e a unidade filtra pelo banco", () => {
    expect(ler(A + "page.tsx")).toContain("lerLinhasDoPainel(supabase, f, alcance)");
    expect(ler(A + "relatorios/page.tsx")).toContain("lerLinhasDoPainel(supabase, f, alcance)");
    expect(ler("src/lib/signatures/relatorio-pedido.ts")).toContain("lerLinhasDoPainel(supabase, f, alcance)");
    expect(ler("src/lib/signatures/painel-dados.ts")).toContain('p_capability: "acao.assinaturas.painel_unidade"');
  });
});

describe("item 4 — o consumo conta o documento criado e cancelado", () => {
  it("mês no relógio de Brasília e gravado também na falha", () => {
    expect(mesDoConsumo(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11");
    const s = ler("src/lib/signatures/send.ts");
    const falha = s.slice(s.indexOf("let cancelado: boolean | null = null;"));
    expect(falha.indexOf("plan_month: mesDoConsumo(")).toBeGreaterThan(0);
    expect(falha.indexOf("plan_month: mesDoConsumo(")).toBeLessThan(falha.indexOf("refuseDocument("));
  });
});

describe("item 5 — o segredo do cron em tempo constante", () => {
  const antes = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = antes;
  });
  it("confere com segredoConfere e recusa sem a variável", () => {
    expect(ler("src/lib/cron-auth.ts")).toContain("segredoConfere(header, `Bearer ${secret}`)");
    process.env.CRON_SECRET = "abc123";
    const req = (h?: string) => new Request("https://x/api/cron/y", { headers: h ? { authorization: h } : {} });
    expect(isCronRequestAuthorized(req("Bearer abc123"))).toBe(true);
    expect(isCronRequestAuthorized(req("Bearer abc124"))).toBe(false);
    expect(isCronRequestAuthorized(req())).toBe(false);
    process.env.CRON_SECRET = "";
    expect(isCronRequestAuthorized(req("Bearer "))).toBe(false);
  });
});

describe("item 6 — o código por WhatsApp só com telefone que a ZapSign aceita", () => {
  it("telefone com dígitos demais vai por e-mail", () => {
    const base = { level: "strong" as const, orderGroup: 1 as const, email: "a@x.com" };
    expect(modoDeAutenticacao({ ...base, phone: "(43) 99999-8888" }).auth_mode).toBe("assinaturaTela-tokenWhatsapp");
    expect(modoDeAutenticacao({ ...base, phone: "1199999888877" }).auth_mode).toBe("assinaturaTela-tokenEmail");
    expect(modoDeAutenticacao({ ...base, phone: null }).auth_mode).toBe("assinaturaTela-tokenEmail");
  });
});

describe("item 7 — a negociação tem de ser do paciente", () => {
  it("a leitura pela origem filtra pelo cliente", () => {
    expect(ler("src/lib/signatures/envio-dados.ts")).toContain('.eq("id", origin.id).eq("client_id", clientId)');
  });
});

describe("item 9 e 12 — URL curta e log sem dado pessoal", () => {
  it("a pré-visualização vale 60 s", () => {
    expect(ler("src/lib/signatures/send.ts")).toContain("createSignedUrl(path, 60)");
  });
  it("CPF, telefone e e-mail somem do texto de erro; o resto fica", () => {
    expect(semDadoPessoal("CPF 123.456.789-09 inválido")).toBe("CPF *** inválido");
    expect(semDadoPessoal("phone +55 (43) 99999-8888 bad")).toBe("phone *** bad");
    expect(semDadoPessoal("email fulano.tal@exemplo.com.br já usado")).toBe("email *** já usado");
    expect(semDadoPessoal("status 400: campo obrigatório 12")).toBe("status 400: campo obrigatório 12");
  });
});

describe("itens 8, 14 e 15 — 0397", () => {
  const m = ler("supabase/migrations/0397_assinaturas_cancelar_relatorio_e_emissora.sql");
  it("cancelar no riSZon não vira recusa do paciente", () => {
    expect(m).toContain("like 'Cancelado no riSZon: %' then");
    expect(m).toContain("and not (v_new_status = 'cancelled' and v_type = 'doc_refused')");
    expect(m).toContain("for update;");
    expect(m).toContain("e.event_type = 'expired_by_routine'");
    // o texto que o riSZon manda é o que a porta reconhece
    expect(ler("src/lib/signatures/pacote.ts")).toContain("rejected_reason: `Cancelado no riSZon: ${motivo}`");
    expect(ler("src/lib/signatures/pacote.ts")).toContain('error.message.includes("ALREADY_CANCELLED")');
  });
  it("relatório com desempate e emissora da empresa conferida", () => {
    expect(m).toContain("order by b.sent_at desc, b.id;");
    expect(m).toContain("raise exception 'ISSUER_NOT_FRANCHISOR';");
    expect(m).toContain("before insert on public.signature_packages");
  });
});
