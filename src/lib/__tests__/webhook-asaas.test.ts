import { existsSync, readFileSync } from "node:fs";
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

// ASA5 (4023, decisão 11b): a Edge Function antiga do ASAAS (o webhook do
// Empresarial, nunca publicado) saiu. O aviso do Asaas chega só pela rota da
// integração nova (/api/webhooks/asaas/[ref]), com a fila e a conferência do
// token. A régua reprova a volta do caminho paralelo de baixa.
describe("webhook antigo do ASAAS (Edge Function do Empresarial)", () => {
  it("não existe mais (nem o cliente antigo que lia ASAAS_API_KEY)", () => {
    expect(existsSync(join(process.cwd(), "supabase", "functions", "asaas-webhook"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src", "lib", "empresarial", "asaas.ts"))).toBe(false);
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
