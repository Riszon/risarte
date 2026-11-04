import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { segredoConfere } from "@/lib/segredo-de-webhook";

// AP99 (03/11/2026): o webhook do ASAAS aceitava QUALQUER chamada quando
// `ASAAS_WEBHOOK_TOKEN` não estava definida (`if (expected) { … }`), e os dois
// webhooks comparavam o segredo com `!==`. Esta régua lê os arquivos e reprova
// a volta — provada quebrando: devolver o `if (expected)` derruba o teste.

const ler = (...p: string[]) =>
  readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("comparação de segredo em tempo constante", () => {
  it("confere o segredo certo e recusa o errado", () => {
    expect(segredoConfere("abc123", "abc123")).toBe(true);
    expect(segredoConfere("abc124", "abc123")).toBe(false);
    expect(segredoConfere("abc12", "abc123")).toBe(false); // tamanho diferente não quebra
  });

  it("segredo vazio ou ausente nunca confere, nem com cabeçalho vazio", () => {
    expect(segredoConfere("", "")).toBe(false);
    expect(segredoConfere("", null)).toBe(false);
    expect(segredoConfere(null, undefined)).toBe(false);
    expect(segredoConfere("x", "   ")).toBe(false);
  });
});

describe("webhook do ASAAS (Edge Function)", () => {
  const fonte = ler("supabase", "functions", "asaas-webhook", "index.ts");

  it("sem ASAAS_WEBHOOK_TOKEN recusa tudo, em vez de aceitar tudo", () => {
    // A brecha era exatamente esta forma: só conferia QUANDO havia segredo.
    expect(fonte).not.toMatch(/if\s*\(\s*expected\s*\)\s*\{/);
    expect(fonte).toMatch(/if\s*\(\s*!expected\s*\)/);
    expect(fonte).toContain("ASAAS_WEBHOOK_TOKEN não configurado");
  });

  it("confere o segredo ANTES de ler o corpo", () => {
    const conferencia = fonte.indexOf("segredoConfere(got, expected)");
    const corpo = fonte.indexOf("await req.json()");
    expect(conferencia).toBeGreaterThan(-1);
    expect(corpo).toBeGreaterThan(-1);
    expect(conferencia).toBeLessThan(corpo);
  });

  it("compara em tempo constante, não com !==", () => {
    expect(fonte).not.toMatch(/got\s*!==\s*expected/);
    expect(fonte).toContain('crypto.subtle.digest("SHA-256"');
  });

  it("não inventa id de evento: sem id, 400 (a idempotência depende dele)", () => {
    expect(fonte).not.toContain("crypto.randomUUID()");
    expect(fonte).toContain("sem id do evento");
  });
});

describe("webhook da ZapSign (rota da Vercel)", () => {
  const fonte = ler("src", "app", "api", "webhooks", "zapsign", "route.ts");

  it("usa a comparação em tempo constante, não !==", () => {
    expect(fonte).toContain('from "@/lib/segredo-de-webhook"');
    expect(fonte).toMatch(/segredoConfere\(got,\s*secret\)/);
    expect(fonte).not.toMatch(/got\s*!==\s*secret/);
  });
});
