// PREPARO DO ROTEIRO DE TESTE DO DONO (4017, 4017a, 4018 e 4020), no projeto de
// teste — pedido do dono em 16/11/2026: "faça você mesmo o roteiro teste".
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/roteiro-dono.preparo.integracao.test.ts
//
// Cria, no banco de TREINO e na conta sandbox de Londrina, os cenários de cada
// passo do roteiro (os "Preparar" e as vendas de partida). Os passos em si são
// feitos pela TELA, no projeto de teste publicado, por e2e-publicado/roteiro-dono.spec.ts.
// Todos os clientes são novos, SEM e-mail e SEM celular: nada é enviado a ninguém.
// Grava os ids em `roteiro-dono.json` (fora do repositório). Recusa a produção.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";
const SAIDA = process.env.ROTEIRO_SAIDA ?? "roteiro-dono.json";

function cpfDeTeste(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (b: number[]) => {
    const r = (b.reduce((s, d, i) => s + d * (b.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dias = (k: number) => iso(new Date(Date.now() + k * 86400000));
const mesesDepois = (s: string, k: number) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + k, d)));
};

describe.skipIf(!LIGADO)("preparo do roteiro do dono", () => {
  it("cria os cenários", async () => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = linha.slice(i + 1).trim();
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO");
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const ldn = (await admin.from("clinics").select("id").eq("name", "Risarte Londrina - Centro").single()).data!.id as string;
    const { data: conta } = await admin.from("gateway_accounts").select("environment").eq("clinic_id", ldn).eq("status", "active").single();
    if (conta?.environment !== "sandbox") throw new Error("RECUSADO: a conta de Londrina não é de sandbox.");
    const gerente = (await admin.from("profiles").select("id").eq("email", "gerente@example.com").single()).data!.id as string;

    // O Gerente de teste passa a ser Gerente de Londrina também (a unidade com a
    // conta sandbox); o fim do roteiro tira este papel.
    const { data: jaTem } = await admin.from("user_clinic_roles_all").select("user_id").eq("user_id", gerente).eq("clinic_id", ldn).eq("role", "unit_manager").maybeSingle();
    if (!jaTem) await admin.from("user_clinic_roles_all").insert({ user_id: gerente, clinic_id: ldn, role: "unit_manager" });

    // A criação automática ligada em Londrina, como numa unidade em uso (o fim do roteiro volta como estava).
    const { data: antes } = await admin.from("gateway_auto_charge_units").select("enabled, enabled_from, fees_enabled_from").eq("clinic_id", ldn).maybeSingle();
    await admin.from("gateway_auto_charge_units").upsert({ clinic_id: ldn, enabled: true, enabled_from: new Date(Date.now() - 60_000).toISOString() }, { onConflict: "clinic_id" });

    const cliente = async (rotulo: string) =>
      (await admin.from("clients").insert({ clinic_id: ldn, full_name: `Roteiro ${rotulo} sem contato`, cpf: cpfDeTeste(), birth_date: "1990-01-01", email: null, phone: null }).select("id").single()).data!.id as string;
    const venda = async (cli: string, rotulo: string, linhas: { due: string; cents: number; meio: string }[], opts: { modo?: "mensal" | "todos"; assinada?: boolean; meio: string }) => {
      const total = linhas.reduce((s, l) => s + l.cents, 0);
      const { data: v, error } = await admin
        .from("direct_sales")
        .insert({ clinic_id: ldn, client_id: cli, client_name: `Roteiro ${rotulo} sem contato`, final_cents: total, payment_method: opts.meio, installments: linhas.length, boleto_mode: opts.modo ?? "mensal" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const ins = linhas.map((l, k) => ({ seq: k + 1, kind: "parcela", due_date: l.due, payment_method: l.meio, amount_cents: l.cents, clinic_id: ldn, client_id: cli, direct_sale_id: v!.id }));
      const e2 = (await admin.from("payment_installments").insert(ins)).error;
      if (e2) throw new Error(e2.message);
      if (opts.assinada !== false) await admin.from("direct_sales").update({ contract_signed: true, contract_signed_at: new Date().toISOString() }).eq("id", v!.id);
      return v!.id as string;
    };
    const { criarCobrancasAutomaticas } = await import("@/lib/asaas/cobrancas-automaticas");

    // A1–A7, A10: forma 1 (um boleto por mês), 6 parcelas; as 4 primeiras dentro
    // do prazo (os boletos nascem na assinatura); a 7ª vencida (para o desconto).
    const cA = await cliente("A forma 1");
    const vA = await venda(cA, "A forma 1", [
      { due: dias(3), cents: 10000, meio: "boleto" },
      { due: dias(6), cents: 10000, meio: "boleto" },
      { due: dias(9), cents: 10000, meio: "boleto" },
      { due: dias(12), cents: 10000, meio: "boleto" },
      { due: mesesDepois(dias(3), 2), cents: 10000, meio: "boleto" },
      { due: mesesDepois(dias(3), 3), cents: 10000, meio: "boleto" },
    ], { meio: "boleto" });
    const rA = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: vA });
    expect(rA.falhas, rA.erros.join(" | ")).toBe(0);
    // A parcela vencida (sem boleto), para ver o desconto por componente.
    await admin.from("payment_installments").insert({ seq: 7, kind: "parcela", due_date: dias(-20), payment_method: "pix", amount_cents: 10000, clinic_id: ldn, client_id: cA, direct_sale_id: vA });

    // A8: forma 2 (todos os boletos agora), 4 parcelas, e a lista com o link.
    const cA8 = await cliente("A8 forma 2");
    const vA8 = await venda(cA8, "A8 forma 2", [0, 1, 2, 3].map((k) => ({ due: mesesDepois(dias(5), k), cents: 10000, meio: "boleto" })), { meio: "boleto", modo: "todos" });
    const rA8 = await criarCobrancasAutomaticas({ origem: "gatilho", directSaleId: vA8 });
    expect(rA8.falhas, rA8.erros.join(" | ")).toBe(0);
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    expect((await admin.from("boleto_lists").insert({ clinic_id: ldn, direct_sale_id: vA8, client_id: cA8, token_hash: hash, expires_at: mesesDepois(dias(5), 4) })).error).toBeNull();

    // A9: venda NÃO fechada (sem o contrato assinado).
    const cA9 = await cliente("A9 nao fechada");
    const vA9 = await venda(cA9, "A9 nao fechada", [{ due: dias(20), cents: 10000, meio: "pix" }, { due: mesesDepois(dias(20), 1), cents: 10000, meio: "pix" }], { meio: "pix", assinada: false });

    // B1–B4: venda direta em dinheiro (sem Asaas), para os acordos e a exceção.
    const cB = await cliente("B excecao");
    const vB1 = await venda(cB, "B excecao", [{ due: dias(20), cents: 10000, meio: "dinheiro" }, { due: mesesDepois(dias(20), 1), cents: 10000, meio: "dinheiro" }], { meio: "dinheiro" });
    const vB2 = await venda(cB, "B excecao", [{ due: dias(25), cents: 10000, meio: "dinheiro" }, { due: mesesDepois(dias(25), 1), cents: 10000, meio: "dinheiro" }], { meio: "dinheiro" });
    // B5: duas vendas do mesmo cliente, para o acordo que junta as duas.
    const cB5 = await cliente("B5 duas vendas");
    const vB5a = await venda(cB5, "B5 duas vendas", [{ due: dias(20), cents: 10000, meio: "dinheiro" }, { due: mesesDepois(dias(20), 1), cents: 10000, meio: "dinheiro" }], { meio: "dinheiro" });
    const vB5b = await venda(cB5, "B5 duas vendas", [{ due: dias(22), cents: 10000, meio: "dinheiro" }, { due: mesesDepois(dias(22), 1), cents: 10000, meio: "dinheiro" }], { meio: "dinheiro" });

    // 4020, item 5: venda direta com algo pago (dinheiro).
    const cD = await cliente("D distrato venda direta");
    const vD = await venda(cD, "D distrato venda direta", [{ due: dias(10), cents: 10000, meio: "dinheiro" }, { due: mesesDepois(dias(10), 1), cents: 10000, meio: "dinheiro" }], { meio: "dinheiro" });

    const saida = {
      criado_em: new Date().toISOString(),
      ldn,
      gerente,
      gerente_ja_tinha_londrina: Boolean(jaTem),
      unidade_antes: antes ?? null,
      A: { cliente: cA, venda: vA, emitidas: rA.criadas },
      A8: { cliente: cA8, venda: vA8, token, emitidas: rA8.criadas },
      A9: { cliente: cA9, venda: vA9 },
      B: { cliente: cB, vendas: [vB1, vB2] },
      B5: { cliente: cB5, vendas: [vB5a, vB5b] },
      D: { cliente: cD, venda: vD },
    };
    writeFileSync(SAIDA, JSON.stringify(saida, null, 2));
    console.log("ROTEIRO", JSON.stringify({ ...saida, A8: { ...saida.A8, token: "(gravado no arquivo)" } }, null, 1));
  }, 600_000);
});
