import { describe, expect, it, vi } from "vitest";
import { isEmailConfigured, sendEmail } from "@/lib/notify/email";
import { eventoParaPorta, tipoDaPorta } from "@/lib/signatures/webhook-event";
import { parseWebhook } from "@/lib/zapsign/webhook";

// O RETORNO DA ZAPSIGN (ZS3): o evento vira o mínimo que a porta do banco
// precisa (sem dado pessoal), e o e-mail pela Resend só promete o que pode.

const corpo = {
  event_type: "doc_signed",
  token: "doc-1",
  open_id: 77,
  external_id: "pkg-1",
  status: "pending",
  name: "ASS-000001 — Maria",
  signed_file: null,
  sandbox: true,
  created_at: "2026-10-31T10:00:00Z",
  last_update_at: "2026-10-31T11:00:00Z",
  signer_who_signed: { token: "s-1", status: "signed", signed_at: "2026-10-31T11:00:00Z", name: "Maria", email: "maria@x.co", phone_number: "43999990000" },
  signers: [
    { token: "s-1", status: "signed", signed_at: "2026-10-31T11:00:00Z", name: "Maria", email: "maria@x.co" },
    { token: "s-2", status: "new", signed_at: null, name: "Testemunha", email: "t@x.co" },
  ],
};

describe("eventoParaPorta", () => {
  it("leva tokens, situações e datas — nunca nome, e-mail ou telefone", () => {
    const e = eventoParaPorta(parseWebhook(corpo)!);
    expect(e.event_type).toBe("doc_signed");
    expect(e.event_key).toBe("doc_signed|doc-1|s-1");
    expect(e.doc_token).toBe("doc-1");
    expect(e.external_id).toBe("pkg-1");
    expect(e.signer_token).toBe("s-1");
    expect(e.signer_signed_at).toBe("2026-10-31T11:00:00Z");
    expect(e.signers).toEqual([
      { token: "s-1", status: "signed", signed_at: "2026-10-31T11:00:00Z" },
      { token: "s-2", status: "new", signed_at: null },
    ]);
    const texto = JSON.stringify(e);
    expect(texto).not.toContain("Maria");
    expect(texto).not.toContain("maria@x.co");
    expect(texto).not.toContain("43999990000");
    expect(e.payload.signed_file).toBe("absent");
  });
  it("tipos conhecidos passam; o resto vira 'other' e ainda assim é registrado", () => {
    expect(tipoDaPorta("doc_refused")).toBe("doc_refused");
    expect(tipoDaPorta("doc_expired")).toBe("doc_expired");
    expect(tipoDaPorta("doc_deleted")).toBe("doc_deleted");
    expect(tipoDaPorta("signature_notification_sent")).toBe("other");
    const e = eventoParaPorta(parseWebhook({ ...corpo, event_type: "email_bounce", signer_who_signed: null })!);
    expect(e.event_type).toBe("other");
    expect(e.raw_event_type).toBe("email_bounce");
    expect(e.event_key).toBe("email_bounce|doc-1|2026-10-31T11:00:00Z");
    expect(e.signer_token).toBeNull();
  });
});

describe("e-mail pela Resend", () => {
  it("sem chave e remetente, diz que não está configurado e não chama a rede", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(isEmailConfigured()).toBe(false);
    const fetchImpl = vi.fn();
    const r = await sendEmail({ to: "a@b.co", subject: "x", text: "y" }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("não configurado"), configured: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("com chave: manda remetente, destinatário com nome, texto e anexo em base64", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendEmail(
      { to: "a@b.co", toName: "Ana", subject: "Seus documentos", text: "oi", attachments: [{ filename: "x.pdf", bytes: new Uint8Array([37, 80, 68, 70]) }] },
      { fetchImpl, apiKey: "re_test", from: "Risarte <assinaturas@risarte.test>" }
    );
    expect(r).toEqual({ ok: true, id: "em_1" });
    expect(chamadas[0].url).toBe("https://api.resend.com/emails");
    const headers = chamadas[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(chamadas[0].init.body));
    expect(body.from).toBe("Risarte <assinaturas@risarte.test>");
    expect(body.to).toEqual(["Ana <a@b.co>"]);
    expect(body.attachments[0]).toEqual({ filename: "x.pdf", content: "JVBERg==" });
  });
  it("resposta de erro vira mensagem pt-BR, configurado = true", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    const r = await sendEmail({ to: "a@b.co", subject: "x", text: "y" }, { fetchImpl, apiKey: "k", from: "f@x.co" });
    expect(r).toEqual({ ok: false, error: "O serviço de e-mail respondeu 422.", configured: true });
  });
});
