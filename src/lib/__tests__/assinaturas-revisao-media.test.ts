import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirLinha, destinatariosDaCopia } from "@/lib/signatures/fila-de-email";
import { prazoDeAssinatura } from "@/lib/signatures/prazo";
import { atualizarContatos, type OldSigner } from "@/lib/signatures/reenvio";
import { desistirDoPdf } from "@/lib/signatures/rotina-horaria";

// Revisão da assinatura digital (11/11/2026), os de prioridade média:
//  - AP153: a cópia ao cliente podia sair sem o PDF anexo;
//  - AP154: o vencimento pela data enterrava assinatura feita no limite, e o
//    prazo terminava às 20:59 de Brasília;
//  - AP155: falhas do pós-assinatura não avisavam ninguém;
//  - AP156: Reenviar como novo pulava a trava do já assinado e os dados novos;
//  - AP157: a trava do Consultor RisLife sumia com outro papel.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");

describe("AP153 — a cópia ao cliente sai com o PDF", () => {
  const agora = new Date("2026-11-11T12:00:00Z");
  it("cópia sem anexo e sem PDF guardado ESPERA; com o PDF do pacote, manda com ele", () => {
    const copia = { kind: "signed_copy", attachment_path: null, created_at: "2026-11-11T10:00:00Z" };
    expect(decidirLinha(copia, null, agora)).toEqual({ acao: "esperar" });
    expect(decidirLinha(copia, "c/patient/p/signed.pdf", agora)).toEqual({ acao: "mandar", anexo: "c/patient/p/signed.pdf" });
  });

  it("alerta de consumo com mais de 7 dias não sai; o novo sai", () => {
    expect(decidirLinha({ kind: "plan_alert", attachment_path: null, created_at: "2026-11-01T10:00:00Z" }, null, agora).acao).toBe("descartar");
    expect(decidirLinha({ kind: "plan_alert", attachment_path: null, created_at: "2026-11-10T10:00:00Z" }, null, agora)).toEqual({ acao: "mandar", anexo: null });
  });

  it("a cópia vai a cada pessoa do lado do cliente com e-mail, sem repetir", () => {
    expect(
      destinatariosDaCopia([
        { name: "Paciente", email: "p@x.com", order_group: 1 },
        { name: "Responsável", email: "R@x.com ", order_group: 1 },
        { name: "Mesmo e-mail", email: "p@X.com", order_group: 1 },
        { name: "Sem e-mail", email: null, order_group: 1 },
        { name: "Testemunha", email: "t@x.com", order_group: 2 },
      ])
    ).toEqual([
      { name: "Paciente", email: "p@x.com" },
      { name: "Responsável", email: "R@x.com" },
    ]);
  });

  it("o aviso da ZapSign e a rotina usam a fila nova; a cópia nunca congela o anexo", () => {
    const w = ler("src/lib/signatures/webhook-apply.ts");
    expect(w).toContain("enfileirarCopias(admin, r.package_id, { registrarSemEmail: true })");
    expect(w).not.toContain("attachment_path: pkg?.signed_pdf_path");
    const f = ler("src/lib/signatures/fila-de-email.ts");
    expect(f).toContain("attachment_path: null,");
    const r = ler("src/lib/signatures/rotina-horaria.ts");
    expect(r).toContain("await copiasQueFaltam(admin, stats);");
    expect(r).toContain("await enfileirarCopias(admin, p.id);");
  });
});

describe("AP154 — vencimento e prazo", () => {
  it("o prazo termina às 23:59 de Brasília", () => {
    // 18/11/2026 23:59 em Brasília (UTC−3) = 19/11/2026 02:59 UTC.
    expect(prazoDeAssinatura(7, "2026-11-11").toISOString()).toBe("2026-11-19T02:59:00.000Z");
  });

  it("os três envios usam o prazo de Brasília (nada de 23:59 UTC)", () => {
    for (const f of ["src/lib/signatures/send.ts", "src/lib/signatures/send-empresa.ts", "src/lib/signatures/reenvio.ts"]) {
      const s = ler(f);
      expect(s, f).toContain("prazoDeAssinatura(");
      expect(s, f).not.toContain("setUTCHours(23, 59");
    }
  });

  it("0396: assinatura no vencido PELA ROTINA vale; rascunho não vira recusado", () => {
    const m = ler("supabase/migrations/0396_assinaturas_vencido_rascunho_e_rislife.sql");
    expect(m).toContain("e.event_type = 'expired_by_routine'");
    expect(m).toContain("if v_pkg.status = 'draft' and v_type in ('doc_refused', 'doc_deleted', 'doc_expired') then");
    expect(m).toContain("elsif v_old_status = 'expired' then");
    expect(m).toContain("for update;");
    // a conferência também olha os vencidos dos últimos 7 dias
    expect(ler("src/lib/signatures/rotina-horaria.ts")).toContain('.eq("status", "expired")');
  });
});

describe("AP155 — falha do pós-assinatura avisa", () => {
  it("o PDF desiste depois de 12 falhas", () => {
    expect(desistirDoPdf(11)).toBe(false);
    expect(desistirDoPdf(12)).toBe(true);
  });

  it("cada falha avisa uma vez (chave única) e a rotina chama o aviso", () => {
    // A conta mora no banco (aviso nasce pela porta, 0316).
    const m = ler("supabase/migrations/0396_assinaturas_vencido_rascunho_e_rislife.sql");
    const f = m.slice(m.indexOf("create or replace function public.signature_failure_notices()"));
    expect(f).toContain("'failure_notice|' || v_e.id");
    expect(f).toContain("on conflict (event_key) do nothing;");
    expect(f).toContain("continue when v_ins = 0;");
    for (const tipo of ["closing_failed", "lead_seal_failed", "pdf_fetch_gave_up", "send_mark_skipped"]) expect(f).toContain(`'${tipo}'`);
    expect(f).toContain("(e.payload->>'doc_cancelled') = 'false'");
    expect(f).toContain("interval '26 hours'");
    expect(m).toContain("revoke execute on function public.signature_failure_notices() from public, anon, authenticated;");
    expect(ler("src/lib/signatures/avisos-de-falha.ts")).toContain('admin.rpc("signature_failure_notices")');
    expect(ler("src/lib/signatures/rotina-horaria.ts")).toContain("await avisarFalhas(admin, stats);");
  });
});

describe("AP156 — Reenviar como novo", () => {
  const antigo = (o: Partial<OldSigner>): OldSigner => ({
    sort_order: 0,
    order_group: 1,
    signer_type: "client",
    name: "Ana Souza",
    cpf: "111",
    email: "velho@x.com",
    phone: "4399990000",
    user_id: null,
    staff_member_id: null,
    auth_mode_applied: null,
    ...o,
  });

  it("os contatos vêm do cadastro de hoje", () => {
    const atuais = {
      cliente: { cpf: "111", email: "novo@x.com", phone: "43988887777" },
      responsaveis: [{ full_name: "Pai da Ana", cpf: "222", email: "pai@x.com", phone: "43977776666" }],
      equipe: new Map([["st1", { cpf: "333", email: "t@x.com", whatsapp: "43966665555" }]]),
    };
    const [c, g, t, sem] = atualizarContatos(
      [
        antigo({}),
        antigo({ signer_type: "legal_guardian", name: "Outro nome", cpf: "222.", email: null, phone: null }),
        antigo({ signer_type: "witness", order_group: 2, staff_member_id: "st1", phone: null }),
        antigo({ signer_type: "witness", order_group: 2, staff_member_id: "st9", phone: "x" }),
      ],
      atuais
    );
    expect(c.email).toBe("novo@x.com");
    expect(c.phone).toBe("43988887777");
    expect(g.phone).toBe("43977776666");
    expect(t.phone).toBe("43966665555");
    expect(sem.phone).toBe("x");
  });

  it("confere signatários e a trava do já assinado ANTES de criar o rascunho", () => {
    const s = ler("src/lib/signatures/reenvio.ts");
    const cria = s.indexOf('rpc("signature_create_package"');
    expect(s.indexOf("validarSignatarios(")).toBeGreaterThan(0);
    expect(s.indexOf("validarSignatarios(")).toBeLessThan(cria);
    expect(s.indexOf("recusaDoNovoEnvio(")).toBeGreaterThan(0);
    expect(s.indexOf("recusaDoNovoEnvio(")).toBeLessThan(cria);
    expect(s).toContain("p_signers: signers,");
  });
});

describe("AP157 — a trava do Consultor RisLife", () => {
  it("vale para quem TEM o papel, não só para quem tem só ele", () => {
    const m = ler("supabase/migrations/0396_assinaturas_vencido_rascunho_e_rislife.sql");
    const f = m.slice(m.indexOf("create or replace function public.signature_consultant_scope_ok"));
    expect(f).toContain("bool_or(ucr.role = 'rislife_consultant')");
    expect(f).toContain("if not v_has_rislife or empresarial.is_program_manager() then");
    expect(f).toContain("return not v_only_rislife;");
    expect(f).not.toContain("if not coalesce(v_only_rislife, false) then\n    return true;");
    expect(m).toContain("revoke execute on function public.signature_consultant_scope_ok(uuid, uuid) from public, anon, authenticated;");
  });
});
