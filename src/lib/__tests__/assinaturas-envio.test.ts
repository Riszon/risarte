import { describe, expect, it } from "vitest";
import { modoDeAutenticacao, nivelDeAutenticacao } from "@/lib/signatures/auth-level";
import { candidatosDoRepresentante, montarSignatarios } from "@/lib/signatures/signers";
import { isFinal, isWaiting } from "@/lib/signatures/status";
import type { SignatureTemplate, StaffSignerOption } from "@/lib/signatures/types";
import { telefoneParaZapsign, validarAnexo, validarSignatarios } from "@/lib/signatures/validate";
import { enderecoEmLinha, montarValores, procedimentosEmLinhas } from "@/lib/signatures/valores";
import { camposDesconhecidos, camposDoModelo, preencherModelo, preencherTexto } from "@/lib/signatures/variables";
import { canaisDoSignatario } from "@/lib/notify/channels";
import { montarMensagem, primeiroNome } from "@/lib/notify/templates";

// AS REGRAS PURAS DO ENVIO (ZS2, plano ZS0 §7 e §5.3): quem assina e em que
// ordem, o nível de autenticação, o que a ZapSign exige, os campos do modelo
// e os canais. Nenhuma delas toca o banco.

const pessoa = (key: string, name: string, extra: Partial<StaffSignerOption> = {}): StaffSignerOption => ({
  key,
  staff_member_id: null,
  user_id: key.startsWith("user:") ? key.slice(5) : null,
  name,
  cpf: "529.982.247-25",
  email: `${key.replace(/\W/g, "")}@example.com`,
  phone: "(43) 99999-0000",
  role_label: "Equipe",
  ...extra,
});

const modelo = (over: Partial<SignatureTemplate> = {}): SignatureTemplate => ({
  id: "t1",
  code: "contrato",
  name: "Contrato",
  audience: "patient",
  kind: "contract",
  body: { preamble: "", sections: [], closing: "" },
  source: null,
  variables: [],
  auth_level: "by_amount",
  witness_count: 2,
  witness_mode: "choose_at_send",
  default_witness_staff_ids: [],
  risarte_signer_mode: "role",
  risarte_signer_role: "unit_manager",
  risarte_signer_user_id: null,
  is_active: true,
  is_provisional_text: true,
  sort_order: 0,
  ...over,
});

const cliente = { name: "Maria Teste", cpf: "111.444.777-35", email: "maria@example.com", phone: "(43) 98888-7777", birthDate: "1990-05-10" };

describe("montarSignatarios", () => {
  it("adulto: cliente no grupo 1, testemunhas no 2, um representante por modelo no 3, sem repetir pessoa", () => {
    const gerente = pessoa("user:g", "Gerente", { cpf: "390.533.447-05" });
    const r = montarSignatarios({
      client: cliente,
      guardians: [],
      todayIso: "2026-10-31",
      templates: [modelo(), modelo({ id: "t2", name: "TCLE", witness_count: 0 })],
      witnesses: [pessoa("user:a", "Ana", { cpf: "529.982.247-25" }), pessoa("staff:b", "Bia", { cpf: "123.456.789-09" })],
      representatives: [gerente, gerente],
    });
    expect(r.blockers).toEqual([]);
    expect(r.clientSide).toBe("client");
    expect(r.signers.map((s) => [s.order_group, s.signer_type])).toEqual([
      [1, "client"],
      [2, "witness"],
      [2, "witness"],
      [3, "risarte_representative"],
    ]);
    expect(r.signers[0].cpf).toBe("11144477735");
    expect(r.witnessesNeeded).toBe(2);
  });

  it("menor de idade: assina o responsável; sem responsável, bloqueia", () => {
    const menor = { ...cliente, birthDate: "2015-01-01" };
    const sem = montarSignatarios({ client: menor, guardians: [], todayIso: "2026-10-31", templates: [modelo({ witness_count: 0 })], witnesses: [], representatives: [pessoa("user:g", "G")] });
    expect(sem.blockers[0]).toMatch(/menor de idade/);
    const com = montarSignatarios({
      client: menor,
      guardians: [{ name: "Mãe Teste", cpf: "529.982.247-25", email: null, phone: "(43) 91111-2222", relationship: "mãe" }],
      todayIso: "2026-10-31",
      templates: [modelo({ witness_count: 0 })],
      witnesses: [],
      representatives: [pessoa("user:g", "G", { cpf: "123.456.789-09" })],
    });
    expect(com.blockers).toEqual([]);
    expect(com.clientSide).toBe("legal_guardian");
    expect(com.signers[0]).toMatchObject({ order_group: 1, signer_type: "legal_guardian", name: "Mãe Teste" });
  });

  it("sem data de nascimento não dá para saber quem assina; testemunha a menos e representante faltando bloqueiam", () => {
    const r = montarSignatarios({
      client: { ...cliente, birthDate: null },
      guardians: [],
      todayIso: "2026-10-31",
      templates: [modelo()],
      witnesses: [pessoa("user:a", "Ana")],
      representatives: [null],
    });
    expect(r.blockers.some((b) => /data de nascimento/.test(b))).toBe(true);
    expect(r.blockers.some((b) => /Faltam testemunhas/.test(b))).toBe(true);
    expect(r.blockers.some((b) => /quem assina pela Risarte/.test(b))).toBe(true);
  });

  it("a mesma pessoa não pode ser testemunha e representante; cliente não pode ser testemunha", () => {
    const ana = pessoa("user:a", "Ana", { cpf: "529.982.247-25" });
    const r = montarSignatarios({ client: cliente, guardians: [], todayIso: "2026-10-31", templates: [modelo({ witness_count: 1 })], witnesses: [ana], representatives: [ana] });
    expect(r.blockers[0]).toMatch(/testemunha e representante/);
    const r2 = montarSignatarios({
      client: cliente,
      guardians: [],
      todayIso: "2026-10-31",
      templates: [modelo({ witness_count: 1 })],
      witnesses: [pessoa("user:x", "Maria", { cpf: cliente.cpf })],
      representatives: [pessoa("user:g", "G", { cpf: "123.456.789-09" })],
    });
    expect(r2.blockers[0]).toMatch(/mesmo CPF/);
  });

  it("candidatosDoRepresentante resolve por papel, quem envia, pessoa fixa e ninguém", () => {
    const sender = pessoa("user:s", "Eu");
    const g1 = pessoa("user:g1", "G1");
    const byRole = { unit_manager: [g1] };
    expect(candidatosDoRepresentante({ template: modelo(), sender, staff: [sender, g1], byRole })).toEqual([g1]);
    expect(candidatosDoRepresentante({ template: modelo({ risarte_signer_mode: "sender" }), sender, staff: [], byRole })).toEqual([sender]);
    expect(candidatosDoRepresentante({ template: modelo({ risarte_signer_mode: "user", risarte_signer_user_id: "g1" }), sender, staff: [g1], byRole })).toEqual([g1]);
    expect(candidatosDoRepresentante({ template: modelo({ risarte_signer_mode: "none" }), sender, staff: [g1], byRole })).toEqual([]);
  });
});

describe("nível e modo de autenticação", () => {
  it("reforçada quando o modelo exige ou o valor passa do corte; o motivo diz qual", () => {
    expect(nivelDeAutenticacao({ templates: [modelo({ auth_level: "strong", name: "X" })], linkedAmountCents: 0, thresholdCents: 500000 })).toMatchObject({ level: "strong", reason: expect.stringContaining('"X" exige') });
    expect(nivelDeAutenticacao({ templates: [modelo()], linkedAmountCents: 730000, thresholdCents: 500000 })).toMatchObject({ level: "strong", reason: expect.stringContaining("R$ 7.300,00") });
    expect(nivelDeAutenticacao({ templates: [modelo()], linkedAmountCents: 500000, thresholdCents: 500000 }).level).toBe("simple");
    expect(nivelDeAutenticacao({ templates: [modelo({ auth_level: "simple" })], linkedAmountCents: 9_000_000, thresholdCents: 500000 }).level).toBe("simple");
  });
  it("o modo: reforçada só para o cliente, por WhatsApp se tem telefone, senão por e-mail", () => {
    expect(modoDeAutenticacao({ level: "strong", orderGroup: 1, phone: "(43) 99999-0000", email: null })).toEqual({ auth_mode: "assinaturaTela-tokenWhatsapp", require_selfie_photo: true });
    expect(modoDeAutenticacao({ level: "strong", orderGroup: 1, phone: null, email: "a@b.co" }).auth_mode).toBe("assinaturaTela-tokenEmail");
    expect(modoDeAutenticacao({ level: "strong", orderGroup: 2, phone: "(43) 99999-0000", email: null })).toEqual({ auth_mode: "assinaturaTela", require_selfie_photo: false });
    expect(modoDeAutenticacao({ level: "simple", orderGroup: 1, phone: "(43) 99999-0000", email: null }).auth_mode).toBe("assinaturaTela");
  });
});

describe("o que a ZapSign exige", () => {
  it("CPF válido e telefone ou e-mail por signatário", () => {
    const base = { sort_order: 0, order_group: 1 as const, signer_type: "client" as const, name: "A", user_id: null, staff_member_id: null, qualification: "Paciente" };
    expect(validarSignatarios([{ ...base, cpf: "52998224725", email: null, phone: "(43) 99999-0000" }])).toEqual([]);
    expect(validarSignatarios([{ ...base, cpf: null, email: "a@b.co", phone: null }])[0].message).toMatch(/sem CPF/);
    expect(validarSignatarios([{ ...base, cpf: "52998224726", email: "a@b.co", phone: null }])[0].message).toMatch(/não é válido/);
    expect(validarSignatarios([{ ...base, cpf: "52998224725", email: null, phone: "9999" }])[0].message).toMatch(/telefone com DDD nem e-mail/);
  });
  it("telefone brasileiro vira país + número só com dígitos", () => {
    expect(telefoneParaZapsign("(43) 99999-0000")).toEqual({ phone_country: "55", phone_number: "43999990000" });
    expect(telefoneParaZapsign("+55 43 3322-1100")).toEqual({ phone_country: "55", phone_number: "4333221100" });
    expect(telefoneParaZapsign("1234")).toBeNull();
  });
  it("anexo: só PDF, até 8 MB, não vazio", () => {
    expect(validarAnexo({ name: "a.pdf", size: 10, type: "application/pdf" })).toBeNull();
    expect(validarAnexo({ name: "a.png", size: 10, type: "image/png" })).toMatch(/não é um PDF/);
    expect(validarAnexo({ name: "a.pdf", size: 0, type: "application/pdf" })).toMatch(/vazio/);
    expect(validarAnexo({ name: "a.pdf", size: 9 * 1024 * 1024, type: "application/pdf" })).toMatch(/8 MB/);
  });
});

describe("campos e valores do modelo", () => {
  it("preenche os campos; vazio e desconhecido viram a linha em branco", () => {
    expect(preencherTexto("Eu, {{paciente_nome}}, CPF {{paciente_cpf}}, {{x}}", { paciente_nome: "Ana", paciente_cpf: "" })).toBe("Eu, Ana, CPF ________________, ________________");
    const body = { preamble: "{{a}}", sections: [{ title: "{{b}}", body: "{{c}} {{a}}" }], closing: "{{d}}" };
    expect(camposDoModelo(body)).toEqual(["a", "b", "c", "d"]);
    expect(camposDesconhecidos(body, "patient")).toEqual(["a", "b", "c", "d"]);
    expect(camposDesconhecidos({ preamble: "{{paciente_nome}}", sections: [], closing: "" }, "patient")).toEqual([]);
    expect(preencherModelo(body, { a: "1" }).sections[0].body).toBe("________________ 1");
  });

  it("montarValores: adulto contrata por si; menor, pelo responsável; endereço e procedimentos em linha", () => {
    const client = { full_name: "Maria Teste", cpf: "11144477735", birth_date: "1990-05-10", phone: "(43) 9", email: "m@e.co", address: "Rua A", address_number: "10", complement: "ap 2", neighborhood: "Centro", city: "Londrina", state: "PR", zip_code: "86000-000" };
    const clinic = { name: "Risarte Londrina", cnpj: "12345678000190", phone: "(43) 3", address: "Av. B", address_number: "1", complement: null, neighborhood: null, city: "Londrina", state: "PR", zip_code: null };
    const treatment = { procedures: [{ description: "Canal", quantity: 1, unitPriceCents: 80000, toothCode: "36", plannedSessions: 2 }, { description: "Profilaxia", quantity: 2, unitPriceCents: 10000 }], totalCents: 100000, conditions: "PIX", validityIso: "2026-11-15", dentistName: null };
    const v = montarValores({ client, guardian: null, isMinor: false, clinic, treatment, packageNumber: "ASS-000007", todayIso: "2026-10-31" });
    expect(v.contratante_nome).toBe("Maria Teste");
    expect(v.contratante_cpf).toBe("111.444.777-35");
    expect(v.unidade_cnpj).toBe("12.345.678/0001-90");
    expect(v.paciente_endereco).toBe("Rua A, 10 (ap 2) – Centro – Londrina/PR – CEP 86000-000");
    expect(v.tratamento_procedimentos).toBe("• Canal — dente 36 — 2 sessões — R$ 800,00\n• Profilaxia — 2× — R$ 200,00");
    expect(v.tratamento_valor_total).toBe("R$ 1.000,00");
    expect(v.tratamento_valor_extenso).toMatch(/mil reais/);
    expect(v.tratamento_validade).toBe("15/11/2026");
    expect(v.documento_numero).toBe("ASS-000007");
    expect(v.documento_data_extenso).toBe("Londrina, 31 de outubro de 2026");
    const m = montarValores({ client: { ...client, birth_date: "2015-01-01" }, guardian: { full_name: "Mãe", cpf: "52998224725", relationship: "mãe" }, isMinor: true, clinic, treatment: null, packageNumber: "ASS-000008", todayIso: "2026-10-31" });
    expect(m.contratante_nome).toBe("Mãe");
    expect(m.contratante_cpf).toBe("529.982.247-25");
    expect(m.responsavel_parentesco).toBe("mãe");
    expect(m.tratamento_procedimentos).toBeNull();
    expect(enderecoEmLinha({ address: null, address_number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null })).toBeNull();
    expect(procedimentosEmLinhas([])).toBeNull();
  });
});

describe("canais e mensagem", () => {
  it("a mensagem preenche os campos e nunca sai sem o link", () => {
    const v = { nome: "Maria", unidade: "Risarte", link: "https://z/x", prazo: "07/11/2026" };
    expect(montarMensagem("Olá {{nome}}, a {{unidade}}: {{link}} até {{prazo}}", v)).toBe("Olá Maria, a Risarte: https://z/x até 07/11/2026");
    expect(montarMensagem("Olá {{nome}}", v)).toBe("Olá Maria\n\nhttps://z/x");
    expect(primeiroNome("  Maria da Silva ")).toBe("Maria");
  });
  it("WhatsApp só com telefone com DDD; copiar e assinar agora sempre", () => {
    const c = canaisDoSignatario({ phone: "(43) 99999-0000", signUrl: "https://z/x", message: "oi https://z/x" });
    expect(c.map((x) => x.id)).toEqual(["whatsapp_link", "copy_link", "sign_now"]);
    expect(c[0].href).toBe("https://wa.me/5543999990000?text=oi%20https%3A%2F%2Fz%2Fx");
    expect(c[2].href).toBe("https://z/x");
    expect(canaisDoSignatario({ phone: null, signUrl: "u", message: "m" })[0].unavailable).toMatch(/sem telefone/);
  });
  it("situações: esperando × finais", () => {
    expect(isWaiting("sent")).toBe(true);
    expect(isWaiting("signed")).toBe(false);
    expect(isFinal("cancelled")).toBe(true);
    expect(isFinal("draft")).toBe(false);
  });
});
