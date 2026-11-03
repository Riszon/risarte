import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eventosDaConferencia } from "@/lib/signatures/conferencia";
import { webhookEventKey } from "@/lib/zapsign/webhook";
import type { ZapsignDocument } from "@/lib/zapsign/types";

// ZS6 — as rotinas. A conferência com a ZapSign transforma a diferença em
// eventos no formato do webhook (a MESMA porta, a MESMA chave de idempotência).

const doc = (over: Partial<ZapsignDocument> = {}): ZapsignDocument => ({
  token: "doc-1",
  open_id: 7,
  status: "pending",
  signed_file: null,
  last_update_at: "2026-11-02T12:00:00Z",
  signers: [
    { token: "s-cliente", status: "signed", signed_at: "2026-11-02T10:00:00Z" },
    { token: "s-testemunha", status: "new", signed_at: null },
    { token: "s-risarte", status: "new", signed_at: null },
  ],
  ...over,
});

describe("conferência com a ZapSign (ZS6)", () => {
  it("quem assinou lá e não aqui vira um doc_signed, com a chave igual à do webhook", () => {
    const ev = eventosDaConferencia({
      doc: doc(),
      locais: [
        { token: "s-cliente", status: "pending" },
        { token: "s-testemunha", status: "pending" },
        { token: "s-risarte", status: "pending" },
      ],
      packageId: "pkg-1",
      sandbox: true,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].eventType).toBe("doc_signed");
    expect(ev[0].signerWhoSigned?.token).toBe("s-cliente");
    expect(ev[0].externalId).toBe("pkg-1");
    // A chave é a do webhook de verdade: se ele chegar depois, é repetido.
    expect(webhookEventKey(ev[0])).toBe("doc_signed|doc-1|s-cliente");
  });

  it("várias assinaturas: um evento por pessoa, na ordem; só o último leva o 'signed' e o PDF", () => {
    const ev = eventosDaConferencia({
      doc: doc({
        status: "signed",
        signed_file: "https://zapsign/assinado.pdf",
        signers: [
          { token: "s-risarte", status: "signed", signed_at: "2026-11-02T11:00:00Z" },
          { token: "s-cliente", status: "signed", signed_at: "2026-11-02T09:00:00Z" },
          { token: "s-testemunha", status: "signed", signed_at: "2026-11-02T10:00:00Z" },
        ],
      }),
      locais: [
        { token: "s-cliente", status: "signed" },
        { token: "s-testemunha", status: "pending" },
        { token: "s-risarte", status: "pending" },
      ],
      packageId: "pkg-1",
      sandbox: false,
    });
    expect(ev.map((e) => e.signerWhoSigned?.token)).toEqual(["s-testemunha", "s-risarte"]);
    expect(ev.map((e) => e.docStatus)).toEqual(["pending", "signed"]);
    expect(ev[0].signedFileUrl).toBeNull();
    expect(ev[1].signedFileUrl).toBe("https://zapsign/assinado.pdf");
  });

  it("nada mudou: nenhum evento; signatário desconhecido é ignorado", () => {
    expect(
      eventosDaConferencia({ doc: doc(), locais: [{ token: "s-cliente", status: "signed" }], packageId: "p", sandbox: true })
    ).toEqual([]);
    const estranho = eventosDaConferencia({
      doc: doc({ signers: [{ token: "outro", status: "signed", signed_at: "2026-11-02T10:00:00Z" }] }),
      locais: [{ token: "s-cliente", status: "pending" }],
      packageId: "p",
      sandbox: true,
    });
    expect(estranho).toEqual([]);
  });

  it("recusado lá vira doc_refused", () => {
    const ev = eventosDaConferencia({
      doc: doc({ status: "refused", signers: [{ token: "s-cliente", status: "new", signed_at: null }] }),
      locais: [{ token: "s-cliente", status: "pending" }],
      packageId: "p",
      sandbox: true,
    });
    expect(ev.map((e) => e.eventType)).toEqual(["doc_refused"]);
  });
});

describe("réguas das rotinas (ZS6)", () => {
  const ler = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  const migracao = ler("supabase/migrations/0346_assinaturas_zs6_rotinas.sql");

  it("o lembrete é só para quem enviou e só enquanto o CLIENTE não assinou (decisão do dono)", () => {
    const i = migracao.indexOf("-- 2.2)");
    const f = migracao.indexOf("-- 2.3)");
    const lembretes = migracao.slice(i, f);
    expect(lembretes).toContain("p.current_stage = 'client'");
    expect(lembretes).toContain("values (v_pkg.sent_by, v_pkg.clinic_id, 'Cliente ainda não assinou'");
    // Nada vai ao cliente sozinho: a rotina não fala com a ZapSign nem com o signatário.
    expect(lembretes).not.toMatch(/signature_signers|outbox/);
  });

  it("o alerta de consumo é só para os Admin Master", () => {
    const i = migracao.indexOf("-- 2.3)");
    const consumo = migracao.slice(i, migracao.indexOf("v_stats := jsonb_build_object"));
    expect(consumo.match(/where pr\.is_admin_master and coalesce\(pr\.is_active, true\)/g)?.length).toBe(2);
  });

  it("as rotinas não respondem a usuário (só o banco e a chave de serviço)", () => {
    expect(migracao).toContain("revoke execute on function public.signature_daily_run() from public, anon, authenticated;");
    expect(migracao).toContain("revoke execute on function public.signature_log_job_run(text, jsonb, text) from public, anon, authenticated;");
    expect(migracao).not.toMatch(/grant execute on function public\.signature_(daily_run|log_job_run)/);
  });

  it("a rota de hora em hora só roda com o segredo da Vercel, e a ZapSign falsa não é consultada", () => {
    expect(ler("src/app/api/cron/signatures-hourly/route.ts")).toMatch(/if \(!isCronRequestAuthorized\(request\)\) \{\s*return new Response\(null, \{ status: 401 \}\);/);
    const rotina = ler("src/lib/signatures/rotina-horaria.ts");
    expect(rotina).toContain('if (stats.zapsign === "ligada") {');
    expect(rotina).toContain("const MAX_TENTATIVAS = 3;");
  });
});
