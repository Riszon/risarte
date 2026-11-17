// PROVA NO SANDBOX — 4020a: o estorno PARCIAL do cartão parcelado pelo caminho do
// riSZon (pedido → confirmação do Gerente → Asaas → a repartição real → os avisos).
//
//   RISARTE_TREINO_POOLER=1 ASAAS_INTEGRACAO=sim npx vitest run src/lib/__tests__/asaas-4020a-estorno-parcial.integracao.test.ts
//
// O parcelado de prova de Londrina (venda direta "Prova 4020a estorno parcial sem
// contato", 3× de R$ 100,00, aprovado em 16/11/2026). Pagador sem contato: nada é
// enviado. No cartão não há autorização do titular (prova de 17/11). Só sandbox.
// O parcial do cartão só é aceito a partir do dia seguinte à aprovação: em 17/11
// o Asaas recusou ("só pode ser estornada parcialmente no próximo dia") e o pedido
// ficou "falhou", sem nada estornado. Rodar de novo a partir de 18/11.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LIGADO = process.env.ASAAS_INTEGRACAO === "sim";
const PRODUCAO = "hvhbijctanrrkxhemlza";
const BLOCO = "4bd55119-985e-4ca0-9d60-92b2bc93b043";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIGADO)("4020a — estorno parcial do parcelado pelo riSZon (sandbox)", () => {
  it("pedido de R$ 120,00, confirmado pelo Gerente, repartido pelo Asaas e gravado", async () => {
    for (const linha of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
      const i = linha.indexOf("=");
      if (i < 1) continue;
      const k = linha.slice(0, i).trim();
      if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(k)) process.env[k] = linha.slice(i + 1).trim();
    }
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCAO)) throw new Error("RECUSADO: nunca contra o banco de produção.");
    const { connect } = await import("../../../scripts/test-db.mjs");
    const pg = (await connect()) as { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };
    try {
      const um = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows[0];
      const conta = await um("select a.environment from public.charges c join public.gateway_accounts a on a.id = c.gateway_account_id where c.installment_block = $1 limit 1", [BLOCO]);
      if (conta?.environment !== "sandbox") throw new Error("RECUSADO: o parcelado não é de sandbox.");
      const adm = (await um("select id from public.profiles where email = 'admin@example.com'")).id as string;
      const ger = (await um("select id from public.profiles where email = 'gerente@example.com'")).id as string;
      const ldn = (await um("select id from public.clinics where name = 'Risarte Londrina - Centro'")).id as string;
      await pg.query(`insert into public.user_clinic_roles_all (user_id, clinic_id, role) select $1, $2, 'unit_manager'
                       where not exists (select 1 from public.user_clinic_roles_all where user_id = $1 and clinic_id = $2 and role = 'unit_manager')`, [ger, ldn]);
      const como = async (id: string, s: string, p: unknown[] = []) => {
        await pg.query("begin");
        try {
          await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
          await pg.query("set local role authenticated");
          const r = (await pg.query(s, p)).rows;
          await pg.query("commit");
          return r;
        } catch (e) {
          await pg.query("rollback");
          throw e;
        }
      };
      // 1) O pedido (o Admin pede) e a confirmação (o Gerente confirma).
      const rq = (await como(adm, "select public.refund_request_create($1::jsonb) j", [JSON.stringify({ block_id: BLOCO, amount_cents: 12000, reason: "Prova 4020a: estorno parcial do parcelado" })]))[0].j as { id: string; needs_confirm: boolean; expected_split: unknown };
      expect(rq.needs_confirm).toBe(true);
      await como(ger, "select public.refund_request_confirm($1)", [rq.id]);
      // 2) O servidor vai ao Asaas (a mesma função das telas).
      const { enviarPedidoDeEstorno } = await import("@/lib/asaas/estorno-parcial");
      const e = await enviarPedidoDeEstorno(rq.id, ger);
      console.log("[prova] envio:", JSON.stringify(e));
      expect(e.ok).toBe(true);
      const r = await um("select status, expected_split, actual_split, split_differs from public.refund_requests where id = $1", [rq.id]);
      console.log("[prova] previsto:", JSON.stringify(r.expected_split), "| o Asaas fez:", JSON.stringify(r.actual_split), "| difere:", r.split_differs);
      expect(r.status).toBe("enviado");
      // 3) Os avisos do Asaas (a parcela inteira: REFUNDED; a parte: PARTIALLY_REFUNDED quando concluir).
      let parcela1 = "";
      for (let i = 0; i < 30; i++) {
        const x = await um(`select i.status, i.refund_closed_at from public.payment_installments i join public.charges c on c.payment_installment_id = i.id
                             where c.installment_block = $1 and c.installment_number = 1`, [BLOCO]);
        parcela1 = `${x.status}${x.refund_closed_at ? " (Estornada)" : ""}`;
        if (x.refund_closed_at) break;
        await espera(3000);
      }
      console.log("[prova] parcela 1:", parcela1);
      const fr = (await pg.query("select c.installment_number n, f.status, f.amount_cents, f.asaas_status from public.charge_refunds f join public.charges c on c.id = f.charge_id where f.request_id = $1 order by 1", [rq.id])).rows;
      console.log("[prova] estornos gravados:", JSON.stringify(fr));
      const eventos = (await pg.query(`select e.event, e.result from public.gateway_webhook_events e join public.charges c on c.id = e.charge_id
                                        where c.installment_block = $1 and e.received_at > now() - interval '10 minutes' order by e.received_at`, [BLOCO])).rows;
      console.log("[prova] avisos:", JSON.stringify(eventos));
      expect(fr.length).toBeGreaterThan(0);
    } finally {
      await pg.end();
    }
  }, 300_000);
});
