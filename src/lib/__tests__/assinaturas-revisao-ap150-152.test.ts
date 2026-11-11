import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createDocumentFromPdf, ZapsignError } from "@/lib/zapsign";
import { caminhoDoAnexo, caminhoDoAnexoValido, lerReferencias } from "@/lib/signatures/anexos-enviados";
import { criacaoIncerta } from "@/lib/signatures/send";

// Revisão da assinatura digital (11/11/2026), os três de prioridade alta:
//  - AP150: anexo acima de 1 MB não passava (limite da ação de servidor);
//  - AP151: o envio podia deixar documento vivo na ZapSign fora do riSZon;
//  - AP152: quem só visualiza lia o link de assinatura do paciente e baixava
//    o PDF direto do armazenamento, sem auditoria.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const A = "src/app/(app)/assinaturas/";

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`;
    if (statSync(join(RAIZ, rel)).isDirectory()) {
      if (nome === "__tests__" || nome === "node_modules") continue;
      out.push(...arquivos(rel));
    } else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

describe("AP150 — anexo vai direto ao armazenamento", () => {
  const eu = "11111111-1111-4111-8111-111111111111";
  const outro = "22222222-2222-4222-8222-222222222222";
  const id = "33333333-3333-4333-8333-333333333333";

  it("só vale o caminho temporário da própria pessoa", () => {
    expect(caminhoDoAnexoValido(caminhoDoAnexo(eu, id), eu)).toBe(true);
    expect(caminhoDoAnexoValido(caminhoDoAnexo(outro, id), eu)).toBe(false);
    expect(caminhoDoAnexoValido(`anexos-temp/${eu}/../${outro}/${id}.pdf`, eu)).toBe(false);
    expect(caminhoDoAnexoValido(`clinica/patient/pacote/merged.pdf`, eu)).toBe(false);
    expect(caminhoDoAnexoValido(`anexos-temp/${eu}/${id}.exe`, eu)).toBe(false);
    expect(caminhoDoAnexoValido(caminhoDoAnexo(eu, id), "")).toBe(false);
  });

  it("referências malformadas viram lista vazia, nunca erro", () => {
    expect(lerReferencias("")).toEqual([]);
    expect(lerReferencias("não é json")).toEqual([]);
    expect(lerReferencias('{"path":"x"}')).toEqual([]);
    expect(lerReferencias('[{"path":"a","name":"b.pdf"},{"path":1},null]')).toEqual([{ path: "a", name: "b.pdf" }]);
  });

  it("as duas janelas mandam o arquivo antes e a ação recebe só referências", () => {
    for (const f of ["enviar-dialog.tsx", "enviar-empresa-dialog.tsx"]) {
      const s = ler(A + f);
      expect(s, f).toContain("await enviarAnexos(");
      expect(s, f).toContain('fd.set("attachment_refs"');
      expect(s, f).not.toMatch(/fd\.append\("attachments"/);
    }
    for (const f of ["envio-actions.ts", "envio-empresa-actions.ts"]) {
      const s = ler(A + f);
      expect(s, f).toContain("lerAnexosEnviados(session.userId");
      expect(s, f).not.toContain('getAll("attachments")');
    }
  });

  it("a autorização de envio confere permissão, PDF e 8 MB", () => {
    const s = ler(A + "anexo-actions.ts");
    expect(s).toContain("canSendSignatures(session)");
    expect(s).toContain("MAX_ATTACHMENT_BYTES");
    expect(s).toContain("createSignedUploadUrl(path)");
    expect(s.indexOf("canSendSignatures(session)")).toBeLessThan(s.indexOf("createSignedUploadUrl"));
  });
});

describe("AP151 — o envio não deixa documento fora do sistema", () => {
  it("a criação do documento NÃO se repete em erro do servidor", async () => {
    let chamadas = 0;
    const impl = (async () => {
      chamadas++;
      return new Response(JSON.stringify(chamadas === 1 ? { detail: "erro" } : { token: "doc2", signers: [] }), {
        status: chamadas === 1 ? 502 : 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const erro = await createDocumentFromPdf(
      { name: "P", base64_pdf: "JVBERi0x", external_id: "pkg", signers: [{ name: "A", email: "a@x.com" }] },
      { token: "t", baseUrl: "https://sandbox.api.zapsign.com.br/api/v1", retryDelayMs: 0, retries: 3, fetchImpl: impl }
    ).then(
      () => null,
      (e: unknown) => e
    );
    expect(erro).toBeInstanceOf(ZapsignError);
    expect(chamadas).toBe(1);
  });

  it("sem resposta da criação, o documento pode existir (fica marcado no rastro)", () => {
    expect(criacaoIncerta(new ZapsignError({ code: "timeout", messagePt: "", logMessage: "" }))).toBe(true);
    expect(criacaoIncerta(new ZapsignError({ code: "network", messagePt: "", logMessage: "" }))).toBe(true);
    expect(criacaoIncerta(new ZapsignError({ code: "server_error", httpStatus: 503, messagePt: "", logMessage: "" }))).toBe(true);
    expect(criacaoIncerta(new ZapsignError({ code: "bad_request", httpStatus: 400, messagePt: "", logMessage: "" }))).toBe(false);
    expect(criacaoIncerta(new Error("DB"))).toBe(false);
  });

  it("o envio reserva o pacote ANTES de criar na ZapSign, e a falha guarda o documento", () => {
    const s = ler("src/lib/signatures/send.ts");
    const corpo = s.slice(s.indexOf("export async function enviarPacote("));
    const reserva = corpo.indexOf("await reservarEnvio(");
    expect(reserva).toBeGreaterThan(0);
    expect(reserva).toBeLessThan(corpo.indexOf("createDocumentFromPdf(docInput)"));
    expect(s).toContain("event_key: `send_claim|${packageId}|${count}`");
    expect(s).toContain('erro.code === "23505"');
    const falha = corpo.slice(corpo.indexOf('event_type: "send_failed"'));
    expect(falha.slice(0, 600)).toContain("doc_token: docToken");
    expect(falha.slice(0, 600)).toContain("doc_cancelled: cancelado");
  });
});

describe("AP152 — link do paciente e PDF só pelo servidor", () => {
  it("a 0395 tira o link e os dados pessoais da leitura do logado e fecha o balde", () => {
    const m = ler("supabase/migrations/0395_assinaturas_link_e_pdf_so_pelo_servidor.sql");
    expect(m).toContain("revoke select on public.signature_signers from anon, authenticated;");
    expect(m).toMatch(/column_name not in \('sign_url', 'zapsign_signer_token', 'cpf', 'email', 'phone'\)/);
    expect(m).toContain('drop policy if exists "signature_documents_select" on storage.objects;');
  });

  it("nenhuma leitura com a sessão da pessoa pede coluna escondida", () => {
    const escondidas = /\b(sign_url|zapsign_signer_token|cpf|email|phone)\b/;
    const achados: string[] = [];
    for (const f of arquivos("src")) {
      const s = ler(f);
      for (const m of s.matchAll(/(\w+)\s*\.from\("signature_signers"\)\s*\.select\("([^"]*)"/g)) {
        if (m[1] !== "admin" && escondidas.test(m[2])) achados.push(`${f}: ${m[1]} lê "${m[2]}"`);
      }
      for (const m of s.matchAll(/signature_signers\s*\(([^)]*)\)/g)) {
        if (escondidas.test(m[1])) achados.push(`${f}: embute ${m[0]}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it("as URLs e os downloads do balde nascem pela chave de serviço", () => {
    for (const f of ["src/lib/signatures/pacote.ts", "src/lib/signatures/reenvio.ts"]) {
      expect(ler(f), f).not.toMatch(/supabase\.storage\.from\(BUCKET\)/);
    }
    const p = ler("src/lib/signatures/pacote.ts");
    expect(p).toContain("await createAdminClient().storage.from(BUCKET)");
  });
});
