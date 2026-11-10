import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abaInicial,
  contratoDoAceite,
  etapasDoCockpit,
  proximoPasso,
  situacaoDoContrato,
  type EntradaDoCockpit,
  type PacoteDoContrato,
} from "@/lib/cockpit-comercial";
import { montarValores, RESUMO_NAO_REGISTRADO } from "@/lib/signatures/valores";
import { CAMPOS_DO_PACIENTE, LINHA_EM_BRANCO, preencherTexto } from "@/lib/signatures/variables";
import { commercialColumnOf } from "@/lib/commercial";

// OC-00158 (03/11/2026), decisões do dono: faixa de etapas + abas no cockpit;
// o resumo da apresentação é obrigatório para o aceite e vai no contrato; o
// fechamento diz quem assinou e quem falta.

const ler = (...p: string[]) =>
  readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

const base: EntradaDoCockpit = {
  naFaseComercial: true,
  temResumo: false,
  negociacao: null,
  venda: null,
  contrato: null,
};

// O caso do relato: cliente e 1 testemunha assinaram; faltam a 2ª testemunha
// e o representante da Risarte.
const parcial: PacoteDoContrato = {
  id: "p1",
  numero: "ASS-000046",
  status: "partially_signed",
  etapaAtual: "witnesses",
  enviadoEm: "2026-11-03T01:14:10Z",
  criadoEm: "2026-11-03T01:10:00Z",
  signatarios: [
    { nome: "Rep", tipo: "risarte_representative", grupo: 3, ordem: 3, status: "pending", assinouEm: null },
    { nome: "Cliente", tipo: "client", grupo: 1, ordem: 0, status: "signed", assinouEm: "2026-11-03T01:15:13Z" },
    { nome: "T2", tipo: "witness", grupo: 2, ordem: 2, status: "link_opened", assinouEm: null },
    { nome: "T1", tipo: "witness", grupo: 2, ordem: 1, status: "signed", assinouEm: "2026-11-03T12:58:40Z" },
  ],
};

describe("o caminho da venda no cockpit", () => {
  it("sem nada feito: a apresentação é a etapa da vez e abre na aba dela", () => {
    const etapas = etapasDoCockpit(base);
    expect(etapas.map((e) => e.situacao)).toEqual(["agora", "depois", "depois", "depois"]);
    expect(abaInicial(base)).toBe("apresentacao");
    expect(proximoPasso(base)).toMatch(/escreva o resumo/i);
  });

  it("em negociação sem resumo: o próximo passo avisa que o aceite não sai", () => {
    const e = { ...base, negociacao: { status: "em_negociacao" as const } };
    expect(abaInicial(e)).toBe("negociacao");
    expect(proximoPasso(e)).toMatch(/sem ele não dá para registrar o aceite/);
    expect(proximoPasso({ ...e, temResumo: true })).toMatch(/registre o aceite/i);
  });

  it("aceita sem resumo (caso antigo): abre na Apresentação e trava o contrato", () => {
    const e = { ...base, negociacao: { status: "aceita" as const } };
    expect(abaInicial(e)).toBe("apresentacao");
    expect(proximoPasso(e)).toMatch(/contrato não pode ser enviado/);
  });

  it("aceita com o contrato parcialmente assinado: diz quantos assinaram e quem falta", () => {
    const e = { ...base, temResumo: true, negociacao: { status: "aceita" as const }, contrato: parcial };
    const etapas = etapasDoCockpit(e);
    expect(etapas.map((x) => x.situacao)).toEqual(["feito", "feito", "agora", "depois"]);
    expect(etapas[2].detalhe).toBe("2 de 4 assinaram");
    expect(abaInicial(e)).toBe("fechamento");
    expect(proximoPasso(e)).toBe(
      "Aguardando as assinaturas: 2 de 4 assinaram. Faltam: testemunha, representante da risarte."
    );
    const s = situacaoDoContrato(parcial);
    expect(s.assinaram.map((x) => x.nome)).toEqual(["Cliente", "T1"]);
    expect(s.faltam.map((x) => x.nome)).toEqual(["T2", "Rep"]);
  });

  it("assinado e não pago: falta o pagamento; pago e fechado: venda concluída", () => {
    const e = {
      ...base,
      temResumo: true,
      negociacao: { status: "aceita" as const },
      contrato: { ...parcial, status: "signed" as const },
      venda: { contractSigned: true, paymentConfirmed: false, closedAt: null },
    };
    expect(etapasDoCockpit(e)[2].detalhe).toBe("Assinado (digital)");
    expect(proximoPasso(e)).toMatch(/falta confirmar o pagamento/i);
    const fechado = { ...e, venda: { contractSigned: true, paymentConfirmed: true, closedAt: "2026-11-03T15:00:00Z" } };
    expect(etapasDoCockpit(fechado).every((x) => x.situacao === "feito")).toBe(true);
    expect(proximoPasso(fechado)).toMatch(/venda concluída/i);
  });

  it("aceita sem resumo mas com o contrato JÁ assinado (o caso do relato): segue para o pagamento", () => {
    const e = {
      ...base,
      negociacao: { status: "aceita" as const },
      contrato: { ...parcial, status: "signed" as const },
      venda: { contractSigned: true, paymentConfirmed: false, closedAt: null },
    };
    expect(abaInicial(e)).toBe("fechamento");
    expect(proximoPasso(e)).toMatch(/falta confirmar o pagamento/i);
    const etapas = etapasDoCockpit(e);
    expect(etapas[0]).toMatchObject({ situacao: "feito", detalhe: "Sem resumo" });
    expect(etapas[3].situacao).toBe("agora");
  });

  it("OC-00171: venda fechada com o cliente já no Início de Tratamento mostra o que foi feito", () => {
    // O cliente do relato: contrato marcado à mão, pagamento confirmado, e a
    // venda moveu o cliente para a Fase 5. A faixa dizia "Ainda não salva".
    const e: EntradaDoCockpit = {
      naFaseComercial: false,
      temResumo: true,
      negociacao: { status: "aceita" },
      venda: { contractSigned: true, paymentConfirmed: true, closedAt: "2026-11-09T21:49:34Z" },
      contrato: null,
    };
    const etapas = etapasDoCockpit(e);
    expect(etapas[1].detalhe).toBe("Aceita pelo cliente");
    expect(etapas[2].detalhe).toBe("Assinado");
    expect(etapas.every((x) => x.situacao === "feito")).toBe(true);
    expect(proximoPasso(e)).toMatch(/venda concluída/i);
    expect(abaInicial(e)).toBe("fechamento");
    // A tela carrega a negociação fora da fase comercial (régua).
    const tela = ler("src", "app", "(app)", "comercial", "[clientId]", "page.tsx");
    expect(tela).toMatch(/inCommercialPhase \|\| depoisDoComercial\s*\?\s*loadNegotiationBlock/);
  });

  it("a aba pedida no endereço vence; uma inválida é ignorada", () => {
    const e = { ...base, temResumo: true, negociacao: { status: "aceita" as const } };
    expect(abaInicial(e, "cliente")).toBe("cliente");
    expect(abaInicial(e, "qualquer")).toBe("fechamento");
  });

  it("o envio mostrado é o mais recente que valeu (rascunho e cancelado sem envio ficam de fora)", () => {
    const antigo = { ...parcial, id: "a", status: "expired" as const, enviadoEm: "2026-11-01T10:00:00Z" };
    const rascunho = { ...parcial, id: "r", status: "draft" as const, enviadoEm: null, criadoEm: "2026-11-04T10:00:00Z" };
    const naoSaiu = { ...parcial, id: "c", status: "cancelled" as const, enviadoEm: null, criadoEm: "2026-11-04T11:00:00Z" };
    expect(contratoDoAceite([antigo, parcial, rascunho, naoSaiu])?.id).toBe("p1");
    expect(contratoDoAceite([rascunho])).toBeNull();
  });
});

describe("o resumo da apresentação vai no contrato quando existe", () => {
  it("o campo existe no catálogo e é preenchido com o resumo", () => {
    expect(CAMPOS_DO_PACIENTE.map((c) => c.chave)).toContain("apresentacao_resumo");
    const client = { full_name: "Maria", cpf: null, birth_date: null, phone: null, email: null, address: null, address_number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null };
    const clinic = { name: "U", cnpj: null, phone: null, address: null, address_number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null };
    const treatment = { procedures: [], totalCents: 0, conditions: null, validityIso: null, dentistName: null, presentationSummary: "  Apresentado o plano.  " };
    const v = montarValores({ client, guardian: null, isMinor: false, clinic, treatment, packageNumber: "ASS-1", todayIso: "2026-11-03" });
    expect(v.apresentacao_resumo).toBe("Apresentado o plano.");
  });

  it("sem resumo (0349, B12), o campo diz que não estava registrado — nunca a linha em branco", () => {
    const client = { full_name: "Maria", cpf: null, birth_date: null, phone: null, email: null, address: null, address_number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null };
    const clinic = { name: "U", cnpj: null, phone: null, address: null, address_number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null };
    const treatment = { procedures: [], totalCents: 0, conditions: null, validityIso: null, dentistName: null, presentationSummary: "   " };
    const v = montarValores({ client, guardian: null, isMinor: false, clinic, treatment, packageNumber: "ASS-1", todayIso: "2026-11-03" });
    expect(v.apresentacao_resumo).toBe(RESUMO_NAO_REGISTRADO);
    expect(preencherTexto("Resumo: {{apresentacao_resumo}}", v)).not.toContain(LINHA_EM_BRANCO);
  });
});

describe("as réguas que prendem a decisão no código", () => {
  it("a 0348 põe a trava no aceite e o campo no contrato provisório", () => {
    const sql = ler("supabase", "migrations", "0348_comercial_resumo_obrigatorio.sql");
    const fn = sql.slice(sql.indexOf("create or replace function public.accept_negotiation"), sql.indexOf("revoke execute"));
    expect(fn).toMatch(/raise exception 'SUMMARY_REQUIRED'/);
    expect(fn).toMatch(/coalesce\(btrim\(cp\.summary\), ''\) <> ''/);
    expect(sql).toMatch(/revoke execute on function public\.accept_negotiation\(uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/and t\.is_provisional_text/);
    expect(sql).toMatch(/position\('apresentacao_resumo' in t\.body::text\) = 0/);
  });

  it("a tela traduz a recusa do aceite", () => {
    const actions = ler("src", "app", "(app)", "apresentacao", "[clientId]", "negotiation-actions.ts");
    expect(actions).toMatch(/m\.includes\("SUMMARY_REQUIRED"\)/);
  });

  it("o envio NÃO exige o resumo (0349, B12: o contrato pode ser assinado na hora)", () => {
    const send = ler("src", "lib", "signatures", "send.ts");
    expect(send).not.toMatch(/faltaResumo/);
    const closing = ler("src", "app", "(app)", "apresentacao", "[clientId]", "closing-panel.tsx");
    expect(closing).toMatch(/\{assinatura && \(/);
    expect(closing).not.toMatch(/resumoFaltando \? \(/);
  });

  it("depois do aceite, o resumo não pode ser apagado", () => {
    const a = ler("src", "app", "(app)", "comercial", "[clientId]", "actions.ts");
    expect(a).toMatch(/\.eq\("status", "aceita"\)/);
    expect(a).toMatch(/não pode ficar vazio/);
  });

  it("o cockpit usa as abas, mostra as assinaturas e não tem mais o quadro 'Em breve'", () => {
    const page = ler("src", "app", "(app)", "comercial", "[clientId]", "page.tsx");
    expect(page).toMatch(/<CockpitAbas/);
    expect(page).toMatch(/contrato=\{contratoDoFechamento\}/);
    expect(page).toMatch(/resumoFaltando=\{!temResumo\}/);
    expect(page).not.toMatch(/Em breve/);
    const closing = ler("src", "app", "(app)", "apresentacao", "[clientId]", "closing-panel.tsx");
    expect(closing).toMatch(/\{contrato && <AssinaturasDoContrato contrato=\{contrato\} \/>\}/);
    expect(closing).toMatch(/Assinaram \(/);
    expect(closing).toMatch(/Faltam \(/);
  });

  it("AP93: o registro da apresentação segue a coluna do QUADRO, não a etapa crua do cartão", () => {
    // O caso do relato: cartão gravado em a_apresentar, negociação aceita.
    expect(
      commercialColumnOf({ journeyPhase: "commercial_conversion", journeyStatus: null, cardStage: "a_apresentar", negotiationAccepted: true })
    ).toBe("fechamento");
    // E quem ainda não aceitou continua vendo o registro da apresentação.
    expect(
      commercialColumnOf({ journeyPhase: "commercial_conversion", journeyStatus: null, cardStage: "a_apresentar", negotiationAccepted: false })
    ).toBe("a_apresentar");
    const page = ler("src", "app", "(app)", "comercial", "[clientId]", "page.tsx");
    expect(page).toMatch(/const colunaDoFunil = commercialColumnOf\(/);
    expect(page).toMatch(/\{colunaDoFunil === "a_apresentar" && \(/);
    expect(page).not.toMatch(/cardStage === "a_apresentar"/);
  });
});
