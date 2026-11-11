// PROVA REAL NO SANDBOX DO ASAAS — opcional, fora do portão do dia a dia.
//
//   npm run test:asaas
//
// Roda o caminho de verdade do servidor contra as contas de TESTE registradas
// no banco de TREINO: lê a chave no Vault pela chave de serviço (a mesma porta
// que o site usa), fala com o sandbox do Asaas e grava situação, tarifas,
// chave Pix e antecipação. Sem `ASAAS_INTEGRACAO=sim` o arquivo inteiro é
// pulado — `npm test` não depende de rede nem de conta.
//
// TRAVAS: só roda com o banco de treino (recusa o projeto de produção pelo
// identificador) e só mexe em conta `sandbox`. Nenhuma chave aparece na saída.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";

describe.skipIf(!LIGADO)("Asaas sandbox — o caminho real do servidor", () => {
  beforeAll(() => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) {
        process.env[k] = linha.slice(i + 1).trim();
      }
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) {
      throw new Error("RECUSADO: este teste nunca roda contra o banco de produção.");
    }
  });

  it("verifica cada conta de teste: chave do Vault aceita, tarifas gravadas", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { verificarConta } = await import("@/lib/asaas/link");
    const admin = createAdminClient();

    const { data: contas, error } = await admin
      .from("gateway_accounts")
      .select("id, label, owner_type, environment")
      .eq("environment", "sandbox")
      .eq("status", "active")
      .not("api_key_secret_id", "is", null);
    expect(error).toBeNull();
    // Zero contas é "não medi", não "passou".
    expect((contas ?? []).length, "nenhuma conta de teste registrada: rode scripts/asaas-sandbox-contas.mjs").toBeGreaterThan(0);

    for (const c of contas ?? []) {
      const r = await verificarConta({ accountId: c.id, actorId: null, purpose: "integration_test" });
      expect(r.status, `${c.label}: ${"error" in r ? r.error : ""}`).toBe("ok");

      const { data: depois } = await admin
        .from("gateway_accounts")
        .select("last_check_ok, api_key_last_used_at, fees_synced_at, pix_key_active")
        .eq("id", c.id)
        .single();
      expect(depois?.last_check_ok).toBe(true);
      expect(depois?.api_key_last_used_at).not.toBeNull();

      if (c.owner_type !== "recipient") {
        expect(depois?.fees_synced_at, `${c.label}: tarifas não sincronizadas`).not.toBeNull();
        const { data: adq } = await admin.from("card_acquirers").select("id, is_default").eq("gateway_account_id", c.id).single();
        expect(adq?.is_default).toBe(false);
        const { count } = await admin
          .from("acquirer_rates")
          .select("id", { count: "exact", head: true })
          .eq("acquirer_id", adq!.id)
          .eq("source", "gateway");
        expect(count ?? 0, `${c.label}: nenhuma tarifa do Asaas gravada`).toBeGreaterThan(0);
      }

      const { count: usos } = await admin
        .from("gateway_key_usage")
        .select("id", { count: "exact", head: true })
        .eq("account_id", c.id)
        .eq("purpose", "integration_test");
      expect(usos ?? 0, `${c.label}: a leitura da chave não foi registrada`).toBeGreaterThan(0);

      const { data: log } = await admin
        .from("gateway_api_log")
        .select("path, http_status")
        .eq("account_id", c.id)
        .eq("purpose", "integration_test");
      expect((log ?? []).length).toBeGreaterThan(0);
      // O registro guarda o MODELO da rota: nada de consulta, chave ou identificador.
      for (const l of log ?? []) expect(l.path).toMatch(/^\/[A-Za-z/{}]+$/);
    }
  }, 120_000);
});
