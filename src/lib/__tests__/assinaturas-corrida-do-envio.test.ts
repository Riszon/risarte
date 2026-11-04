import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ZS8 (achado no teste real do sandbox, 03/11/2026): o aviso "documento
// criado" da ZapSign chegou 14 ms depois de o envio gravar "enviado" e gravou
// RASCUNHO por cima — `signature_apply_webhook` lia o pacote sem trava e
// regravava o que tinha lido (ASS-000050). A 0359 trava a leitura (`for
// update`): quem chega depois espera e vê o que o outro gravou.
//
// A primeira tentativa de conserto forçava "rascunho → enviado" no aviso, e
// isso fez o aviso passar na frente e a gravação do envio (que só vale sobre
// rascunho) não gravar quem enviou nem o mês do consumo (ASS-000052). A régua
// prende as duas lições.

const RAIZ = join(__dirname, "..", "..", "..");
const PASTA = join(RAIZ, "supabase", "migrations");

function ultimaDefinicao(nome: string): string {
  let corpo = "";
  const FN = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${nome}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi"
  );
  for (const arquivo of readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(join(PASTA, arquivo), "utf8");
    for (const m of sql.matchAll(FN)) corpo = m[2];
  }
  return corpo;
}

describe("o aviso da ZapSign não desfaz o envio (0359)", () => {
  const corpo = ultimaDefinicao("signature_apply_webhook");

  it("a função existe nas migrações", () => {
    expect(corpo.length).toBeGreaterThan(500);
  });

  it("lê o pacote COM trava, pelo token e pelo id", () => {
    const leituras = corpo.match(/select \* into v_pkg from public\.signature_packages[^;]*;/g) ?? [];
    expect(leituras.length).toBe(2);
    for (const l of leituras) expect(l, l).toMatch(/for update;$/);
  });

  it("não força o pacote de rascunho para enviado (quem grava o envio é o envio)", () => {
    expect(corpo).not.toMatch(/when v_pkg\.status = 'draft' then 'sent'/);
  });

  it("o envio não fica calado quando a gravação de 'enviado' não pega", () => {
    const envio = readFileSync(join(RAIZ, "src", "lib", "signatures", "send.ts"), "utf8");
    expect(envio).toMatch(/\.eq\("status", "draft"\)\s*\.select\("id"\)/);
    expect(envio).toContain('event_type: "send_mark_skipped"');
  });
});
