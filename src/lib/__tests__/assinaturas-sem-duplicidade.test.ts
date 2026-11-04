import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clienteJaAssinou,
  mensagemDoConflito,
  numeroDoConflito,
  podeLiberarNovoEnvio,
  recusaDoNovoEnvio,
  situacaoDasAssinaturas,
} from "@/lib/signatures/duplicidade";
import { rotuloDoEvento } from "@/lib/signatures/eventos";
import { mensagemDaPorta } from "@/lib/signatures/send";

// AP108 (decisão do dono, 04/11/2026): "não pode ter o risco de assinar duas
// vezes o mesmo documento". Visto no teste real da ZS8: dois pacotes com o
// mesmo contrato abertos ao mesmo tempo (ASS-000049 e ASS-000050) — para a
// ZapSign são dois documentos, e assinar um não trava o outro.
//
// O banco recusa (0361): na criação (cada documento) e no envio (rascunho →
// enviado, com trava por parte para dois envios simultâneos). A tela explica
// antes e oferece "Cancelar o anterior e enviar este". Documento já ASSINADO
// por todos TRAVA desde 04/11/2026 (ASS-000063/064 no treino): só sai de novo
// com motivo escrito, pelo Gerente da unidade ou pelo Admin.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const migracoes = () =>
  readdirSync(join(RAIZ, "supabase", "migrations"))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => ler(`supabase/migrations/${f}`))
    .join("\n");

describe("o banco não deixa dois pacotes abertos com o mesmo documento (0361)", () => {
  const sql = migracoes();

  it("há gatilho na criação (itens) e no envio (pacote)", () => {
    expect(sql).toMatch(/create trigger signature_items_no_duplicate_open\s+before insert on public\.signature_package_items/);
    expect(sql).toMatch(/create trigger signature_packages_no_duplicate_open\s+before update of status on public\.signature_packages/);
  });

  it("os dois gatilhos usam a trava por parte (dois envios ao mesmo tempo)", () => {
    const corpos = [...sql.matchAll(/create or replace function public\.signature_(items|packages)_no_duplicate_open\(\)[\s\S]*?\$function\$;/g)].map((m) => m[0]);
    expect(corpos.length).toBeGreaterThanOrEqual(2);
    for (const c of corpos) expect(c).toContain("_signature_party_lock(");
  });

  it("só conta pacote AGUARDANDO; cancelado e assinado não bloqueiam", () => {
    const conflito = /create or replace function public\._signature_open_conflict[\s\S]*?\$function\$;/.exec(sql)?.[0] ?? "";
    expect(conflito).toContain("p.status in ('sent', 'partially_signed')");
  });
});

describe("a tela explica e oferece a saída", () => {
  it("a recusa do banco vira a mensagem com o número do pacote aberto", () => {
    expect(numeroDoConflito("OPEN_PACKAGE_EXISTS:ASS-000049")).toBe("ASS-000049");
    expect(numeroDoConflito("outra coisa")).toBeNull();
    expect(mensagemDaPorta('new row ... OPEN_PACKAGE_EXISTS:ASS-000049')).toBe(mensagemDoConflito("ASS-000049"));
  });

  it("a preparação confere antes de criar (paciente e empresa)", () => {
    for (const f of ["src/lib/signatures/send.ts", "src/lib/signatures/send-empresa.ts"]) {
      const s = ler(f);
      const confere = s.indexOf("pacoteAbertoComOsMesmos(");
      const cria = s.indexOf('rpc("signature_create_package"');
      expect(confere, f).toBeGreaterThan(0);
      expect(confere, `${f}: a conferência vem antes da criação`).toBeLessThan(cria);
      expect(s, f).toContain("pacoteAssinadoComOsMesmos(");
      expect(s, f).toContain("recusaDoNovoEnvio(");
      expect(s, f).not.toContain("confirmouJaAssinado");
      // o motivo vai para a história do pacote novo, depois de criado
      const registra = s.indexOf("registrarMotivoDoNovoEnvio(createAdminClient()");
      expect(registra, f).toBeGreaterThan(cria);
    }
  });

  it("o botão de preparar não passa o clique como 'já confirmei' (as duas janelas)", () => {
    for (const f of ["src/app/(app)/assinaturas/enviar-dialog.tsx", "src/app/(app)/assinaturas/enviar-empresa-dialog.tsx"]) {
      const s = ler(f);
      expect(s, f).not.toContain("onClick={preparar}");
      expect(s, f).toContain("<AvisoDeDuplicidade");
      expect(s, f).toContain("onEnviarComMotivo={(motivo) => preparar(motivo)}");
      expect(s, f).toContain('typeof motivo === "string"');
    }
  });

  it("o aviso cancela o anterior com o motivo da substituição", () => {
    const s = ler("src/app/(app)/assinaturas/aviso-de-duplicidade.tsx");
    expect(s).toContain("cancelarPacoteDeAssinatura(");
    expect(s).toContain("MOTIVO_DA_SUBSTITUICAO");
  });
});

// Pedido do dono (04/11/2026, primeiro TCLE real): com o paciente já tendo
// assinado e só a Risarte faltando, o aviso dizia "ainda não foi assinado" e
// oferecia cancelar em destaque — o paciente assinaria o mesmo documento duas
// vezes. Vale para o paciente e para a empresa (a mesma janela de aviso).
describe("o pacote aberto diz quem já assinou", () => {
  const linhas = [
    { name: "Ana Paciente", signer_type: "client", order_group: 1, status: "signed", signed_at: "2026-11-04T15:07:00Z", user_id: null },
    { name: "Bruno Gerente", signer_type: "risarte_representative", order_group: 3, status: "pending", signed_at: null, user_id: "u-bruno" },
  ];

  it("separa quem assinou de quem falta, e marca quem está enviando", () => {
    const p = situacaoDasAssinaturas(linhas, "u-bruno");
    expect(p.assinaram.map((a) => a.name)).toEqual(["Ana Paciente"]);
    expect(p.assinaram[0]).toMatchObject({ ladoDoCliente: true, qualificacao: "Paciente", assinouEm: "2026-11-04T15:07:00Z" });
    expect(p.faltam).toEqual([expect.objectContaining({ name: "Bruno Gerente", souEu: true, ladoDoCliente: false })]);
    expect(clienteJaAssinou(p)).toBe(true);
  });

  it("só a assinatura do lado do cliente conta (testemunha ou Risarte não)", () => {
    const p = situacaoDasAssinaturas(
      [{ name: "Teo", signer_type: "witness", order_group: 2, status: "signed", signed_at: null, user_id: null }],
      null,
    );
    expect(clienteJaAssinou(p)).toBe(false);
    expect(situacaoDasAssinaturas(linhas, null).faltam[0].souEu).toBe(false);
  });

  it("a representante da empresa também é o lado do cliente", () => {
    const p = situacaoDasAssinaturas(
      [{ name: "Carla RH", signer_type: "company_representative", order_group: 1, status: "signed", signed_at: null, user_id: null }],
      null,
    );
    expect(clienteJaAssinou(p)).toBe(true);
  });

  it("a mensagem diz quem assinou, quando (no horário do Brasil) e quem falta", () => {
    const m = mensagemDoConflito("ASS-000070", situacaoDasAssinaturas(linhas, null));
    expect(m).toContain("já foi assinado por Ana Paciente (paciente) em 04/11/2026, 12:07");
    expect(m).toContain("falta Bruno Gerente (representante da Risarte)");
    expect(m).toContain("cancelar faria o cliente assinar de novo");
    expect(m).not.toContain("cancele o anterior");
  });

  it("a preparação e a recusa do banco levam quem assinou (paciente e empresa)", () => {
    for (const f of ["src/lib/signatures/send.ts", "src/lib/signatures/send-empresa.ts"]) {
      const s = ler(f);
      expect(s, f).toContain("pacoteAbertoComOsMesmos(supabase, ");
      expect(s, f).toMatch(/pacoteAbertoComOsMesmos\([^)]*input\.session\.userId\)/);
      expect(s, f).toContain("mensagemDoConflito(aberto.number, aberto)");
      expect(s, f).toContain("pacoteAbertoPeloNumero(");
      expect(s, f).not.toContain("mensagemDoConflito(conflitoNoBanco)");
    }
  });

  it("com o cliente já assinado, cancelar pede a segunda confirmação", () => {
    const s = ler("src/app/(app)/assinaturas/aviso-de-duplicidade.tsx");
    const bloco = s.slice(s.indexOf("clienteJaAssinou(duplicidade)"), s.indexOf('if (duplicidade.tipo === "aberto") {'));
    expect(bloco).toContain("Cancelar mesmo assim");
    expect(bloco).toContain("vai ter que assinar de novo");
    // o primeiro clique só abre a confirmação; quem cancela é o segundo
    expect(bloco).toMatch(/onClick=\{\(\) => setConfirmandoCancelar\(true\)\}[^]*Cancelar mesmo assim/);
    expect(bloco.indexOf("onClick={cancelarEEnviar}")).toBeGreaterThan(bloco.indexOf("confirmandoCancelar ? ("));
    expect(bloco).toContain("Assinar agora");
  });
});

describe("o documento já assinado por todos trava (ASS-000063/064)", () => {
  const assinado = { number: "ASS-000063", completedAt: "2026-11-04T19:57:01.246Z" };
  const gerente = { isAdminMaster: false, rolesByClinic: { u1: ["unit_manager"], u2: ["commercial_consultant"] } };
  const consultor = { isAdminMaster: false, rolesByClinic: { u1: ["commercial_consultant"] } };
  const admin = { isAdminMaster: true, rolesByClinic: {} };

  it("só o Gerente DA UNIDADE emissora ou o Admin liberam", () => {
    expect(podeLiberarNovoEnvio(gerente, "u1")).toBe(true);
    expect(podeLiberarNovoEnvio(gerente, "u2")).toBe(false);
    expect(podeLiberarNovoEnvio(consultor, "u1")).toBe(false);
    expect(podeLiberarNovoEnvio(admin, "u9")).toBe(true);
  });

  it("sem motivo, recusa — e diz quando foi assinado", () => {
    const r = recusaDoNovoEnvio({ assinado, motivo: null, podeLiberar: true });
    expect(r).toContain("ASS-000063");
    expect(r).toContain("04/11/2026, 16:57");
    expect(r).toContain("Não é preciso assinar de novo");
    expect(recusaDoNovoEnvio({ assinado, motivo: "   ", podeLiberar: true })).not.toBeNull();
  });

  it("com motivo, quem não pode liberar continua recusado (o clique não basta)", () => {
    expect(recusaDoNovoEnvio({ assinado, motivo: "contrato do novo tratamento", podeLiberar: false })).toContain("Gerente da unidade ou o Admin");
  });

  it("motivo curto demais é recusado; motivo de verdade libera", () => {
    expect(recusaDoNovoEnvio({ assinado, motivo: "ok", podeLiberar: true })).toContain("pelo menos");
    expect(recusaDoNovoEnvio({ assinado, motivo: "contrato do novo tratamento", podeLiberar: true })).toBeNull();
  });

  it("o motivo aparece na história do pacote novo", () => {
    expect(rotuloDoEvento("new_send_reason", { reason: "contrato do implante", previous_number: "ASS-000063" })).toBe(
      "Enviado de novo um documento já assinado (já assinado no ASS-000063) — motivo: contrato do implante",
    );
  });

  it("o aviso não tem mais o 'Enviar mesmo assim' de um clique", () => {
    const s = ler("src/app/(app)/assinaturas/aviso-de-duplicidade.tsx");
    expect(s).not.toContain("Enviar mesmo assim");
    expect(s).toContain("É um documento novo");
    expect(s).toMatch(/disabled=\{!motivoOk\}[^]*Enviar de novo com este motivo/);
    expect(s).toContain("{duplicidade.podeLiberar && (");
  });
});
