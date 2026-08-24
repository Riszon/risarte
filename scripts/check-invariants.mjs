// CONFERÊNCIA DAS INVARIANTES DO SISTEMA (camada 1)
//
// Verifica se os DADOS que os relatórios leem estão sãos. Se o razão está
// consistente, o relatório não tem de onde tirar número errado — e foi
// exatamente aí que moraram os defeitos que chegaram ao dono: a venda cancelada
// que continuava como receita, a liquidação contada junto com a competência.
//
// POR QUE NÃO CHAMA AS FUNÇÕES DE RELATÓRIO: elas exigem usuário logado
// (`can_see_clinic_finance`, 0227). Um script fora do navegador não é ninguém, e
// elas devolveriam vazio — o que passaria como "tudo certo" sendo cegueira. As
// telas ficam para as camadas 2 e 3, que rodam logadas.
//
// AS REGRAS FICAM EM `invariant-rules.mjs`, com teste: cada uma é exercitada
// com o defeito real que já aconteceu. Aqui mora só a leitura e o relatório.
//
// LGPD: imprime só CONTAGENS e VALORES. Nenhum nome, nenhum documento, nenhum
// id de paciente. É condição para poder rodar isto contra o banco de verdade.
//
// Uso:  npm run check:dados
// Sai com código 1 se alguma invariante falhar.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  allocationMismatch,
  balanceMismatch,
  cancelledStillRevenue,
  feePayableMismatch,
  mixedAccrualAndCash,
  orphanReversals,
  overDepreciated,
  paidButNotSettled,
  receivedMismatch,
  unknownMovementKinds,
} from "./invariant-rules.mjs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/** Lê a tabela inteira, em páginas — o `limit` padrão do PostgREST é 1000. */
async function all(table, columns, filter = (q) => q) {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await filter(
      db.from(table).select(columns).range(page * 1000, page * 1000 + 999)
    );
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const brl = (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function main() {
  console.log("Conferindo as invariantes do sistema...\n");

  // ---- leitura -------------------------------------------------------------
  const [
    entries,
    installments,
    payables,
    payments,
    assets,
    depreciations,
    balances,
    movements,
    roundItems,
    allocations,
    orderItems,
    receiptItems,
    splits,
  ] = await Promise.all([
    all(
      "financial_entries",
      "id, source_type, source_id, status, amount_cents, cash_date, reversal_of"
    ),
    all("payment_installments", "id, status, paid_amount_cents"),
    all("payables", "id, status, amount_cents, paid_amount_cents, network_fee, fee_period, clinic_id"),
    all("payable_payments", "payable_id, discount_cents, reversed, reversal_of"),
    all("fixed_assets", "id, cost_cents"),
    all("asset_depreciations", "asset_id, amount_cents"),
    all("stock_balances", "clinic_id, item_id, quantity, in_use_quantity"),
    all("stock_movements", "clinic_id, item_id, kind, quantity"),
    all(
      "purchase_round_items",
      "id, requested_quantity, adjusted_quantity, awarded_supplier_id"
    ),
    all("purchase_allocations", "round_item_id, allocated_quantity"),
    all("purchase_order_items", "id, quantity, received_quantity"),
    all("purchase_receipt_items", "order_item_id, quantity"),
    all("split_charges", "clinic_id, fee, period_month, amount_cents, reversed"),
  ]);

  // ---- financeiro ----------------------------------------------------------
  const fantasma = cancelledStillRevenue(entries, installments);
  check(
    "Parcela cancelada não conta como receita",
    fantasma.length === 0,
    fantasma.length > 0
      ? `${fantasma.length} lançamento(s) de parcela cancelada ainda em aberto, ` +
        `somando ${brl(fantasma.reduce((s, e) => s + e.amount_cents, 0))}. ` +
        `O gatilho da 0226 deveria tê-los cancelado.`
      : ""
  );

  const mistura = mixedAccrualAndCash(entries);
  check(
    "Competência e caixa não se misturam",
    mistura.accrualWithCash.length === 0 && mistura.cashWithoutDate.length === 0,
    mistura.accrualWithCash.length + mistura.cashWithoutDate.length > 0
      ? `${mistura.accrualWithCash.length} de competência com data de caixa e ` +
        `${mistura.cashWithoutDate.length} de caixa sem ela. É a separação que faz ` +
        `a DRE e o fluxo lerem metades diferentes do mesmo razão.`
      : ""
  );

  const orfaos = orphanReversals(entries);
  check(
    "Todo estorno tem original marcado",
    orfaos.length === 0,
    orfaos.length > 0
      ? `${orfaos.length} contra-lançamento(s) com original fora de 'reversed'. ` +
        `O valor entraria nos relatórios com o sinal invertido.`
      : ""
  );

  const naoQuitadas = paidButNotSettled(payables, payments);
  check(
    "Conta marcada como paga está quitada",
    naoQuitadas.length === 0,
    naoQuitadas.length > 0
      ? `${naoQuitadas.length} conta(s) 'paga' com pago + desconto abaixo do valor.`
      : ""
  );

  const depExcedida = overDepreciated(assets, depreciations);
  check(
    "Depreciação não passa do custo do bem",
    depExcedida.length === 0,
    depExcedida.length > 0
      ? `${depExcedida.length} bem(ns) depreciado(s) além do que custaram.`
      : ""
  );

  // ---- estoque -------------------------------------------------------------
  const kindsNovos = unknownMovementKinds(movements);
  check(
    "Todo tipo de movimento é conhecido pela conferência",
    kindsNovos.length === 0,
    kindsNovos.length > 0
      ? `Tipos não previstos: ${kindsNovos.join(", ")}. A conferência do saldo os ` +
        `estaria ignorando em silêncio.`
      : ""
  );

  const saldos = balanceMismatch(balances, movements);
  check(
    "Saldo do estoque bate com os movimentos",
    saldos.length === 0,
    saldos.length > 0
      ? `${saldos.length} saldo(s) diferente(s) da soma dos movimentos. O saldo é ` +
        `derivado: divergir significa que alguém escreveu nele por fora.`
      : ""
  );

  // ---- compras -------------------------------------------------------------
  const rateio = allocationMismatch(roundItems, allocations);
  check(
    "Rateio da rodada soma o total comprado",
    rateio.length === 0,
    rateio.length > 0
      ? `${rateio.length} item(ns) com a soma das partes diferente do total comprado.`
      : ""
  );

  const recebimentos = receivedMismatch(orderItems, receiptItems);
  check(
    "Recebido do pedido bate com as entregas",
    recebimentos.length === 0,
    recebimentos.length > 0
      ? `${recebimentos.length} item(ns) de pedido com recebido diferente da soma ` +
        `das entregas.`
      : ""
  );

  const taxas = feePayableMismatch(
    splits,
    payables.filter((p) => p.network_fee)
  );
  check(
    "Conta da taxa bate com os recebimentos que a geraram",
    taxas.length === 0,
    taxas.length > 0
      ? `${taxas.length} conta(s) de taxa com valor diferente da soma dos splits.`
      : ""
  );

  // ---- relatório -----------------------------------------------------------
  const largura = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(
      `  ${r.ok ? "OK  " : "FALHA"}  ${r.name.padEnd(largura)}` +
        (r.detail ? "\n         " + r.detail : "")
    );
  }

  const falhas = results.filter((r) => !r.ok);
  console.log(
    `\nVolume conferido: ${entries.length} lançamentos, ${payables.length} contas a ` +
      `pagar, ${balances.length} saldos (${movements.length} movimentos), ` +
      `${orderItems.length} itens de pedido, ${splits.length} splits.`
  );
  console.log(
    falhas.length === 0
      ? `\n${results.length} invariantes conferidas, nenhuma falha.`
      : `\n${falhas.length} de ${results.length} invariantes FALHARAM.`
  );

  // Invariante sem dado não é invariante aprovada — dizer isso evita que o
  // silêncio de um banco vazio seja lido como saúde.
  const vazios = [];
  if (entries.length === 0) vazios.push("lançamentos");
  if (movements.length === 0) vazios.push("movimentos de estoque");
  if (orderItems.length === 0) vazios.push("pedidos de compra");
  if (vazios.length > 0) {
    console.log(
      `\nATENÇÃO: sem dados de ${vazios.join(", ")}. As conferências desses ` +
        `assuntos passaram por AUSÊNCIA, não por estarem certas.`
    );
  }

  // Encerrar à força derruba o cliente com conexão aberta, e o Windows devolve
  // erro de handle em vez do código real. Definir o código e deixar o Node sair
  // sozinho entrega o número que a automação vai ler.
  process.exitCode = falhas.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("Erro ao conferir:", e.message);
  process.exitCode = 2;
});
