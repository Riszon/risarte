// E2E-6 — COMPRAS, DA NECESSIDADE AO RECEBIMENTO.
//
// A regra que organiza o módulo: **a negociação é da rede, o dinheiro é da
// unidade**. A franqueadora consolida e negocia por todas; cada unidade aprova,
// é faturada e paga a sua parte.
//
// MÉTODO, e vale declarar: este teste chama as FUNÇÕES OFICIAIS do sistema —
// as mesmas que as telas chamam — com o papel certo em cada passo. O fluxo tem
// quatro telas e três pessoas, e encenar todas custaria muito para provar as
// mesmas regras. Quem confere que as telas abrem é a camada 2; quem confere que
// as regras valem é este teste. Cada chamada roda COMO a pessoa que a faria no
// app, então as guardas de permissão são exercitadas de verdade.
//
// As duas regras mais afiadas:
//
// 1. **EM BRANCO NÃO É ZERO.** Fornecedor que não cotou não concorre; zero é um
//    preço de verdade (bonificação) e concorre. Confundir os dois faria a mesa
//    premiar justamente quem não respondeu — e o pedido nasceria sem preço.
// 2. **A NOTA MANDA NO PREÇO, NÃO O PEDIDO.** Chegou por outro valor, entra o
//    valor da nota: é o que foi pago. A diferença vira evidência para a próxima
//    negociação, em vez de ser barrada e deixar o material fora do estoque.

import { expect, test } from "@playwright/test";
import { PESSOAS, banco, comoUsuario } from "./apoio";
import { limparMovimento } from "../scripts/reset-test.mjs";

test.setTimeout(300_000);

test.beforeAll(async () => {
  const db = await banco();
  await limparMovimento(db);
  await db.end();
});

test("da requisição ao recebimento, com a nota mandando no preço", async () => {
  const db = await banco();
  const { rows: base } = await db.query(`
    select
      (select id from public.clinics where code = 'CAM') as cambe,
      (select id from public.stock_items where name = 'Sugador descartável') as item
  `);
  const { cambe, item } = base[0];

  const gerente = await comoUsuario(PESSOAS.gerente);

  // O MÍNIMO É DA UNIDADE, e mora no próprio saldo dela. Definido pela porta
  // oficial (`set_stock_item_settings`), com as permissões do Gerente — é ele
  // quem define mínimo e máximo.
  const { error: erroMinimo } = await gerente.rpc("set_stock_item_settings", {
    p_clinic_id: cambe,
    p_item_id: item,
    p_min: 50,
    p_max: 100,
    p_storage_location: null,
    p_supplier_id: null,
  });
  expect(erroMinimo, erroMinimo?.message).toBeNull();

  // ---- 1. a unidade monta a necessidade (PC-) ------------------------------
  // A lista vem da reposição do Estoque: quem decide o que falta continua sendo
  // ele, e uma segunda régua aqui divergiria dele.
  const { data: requisicao, error: erroReq } = await gerente.rpc(
    "build_purchase_request",
    { p_clinic_id: cambe, p_is_local: false }
  );
  expect(erroReq, erroReq?.message).toBeNull();

  const { rows: pedido } = await db.query(
    "select code, status from public.purchase_requests where id = $1",
    [requisicao]
  );
  // O código do documento nunca some — aqui ele nasce.
  expect(pedido[0].code).toMatch(/^PC-/);
  expect(pedido[0].status).toBe("rascunho");

  // Rascunho é da unidade: a franqueadora só enxerga depois de enviado.
  const { error: erroEnvio } = await gerente.rpc("send_purchase_request", {
    p_id: requisicao,
  });
  expect(erroEnvio, erroEnvio?.message).toBeNull();

  // ---- 2. a franqueadora abre a mesa (RC-) ---------------------------------
  const comprador = await comoUsuario(PESSOAS.comprador);
  const { data: rodada, error: erroRodada } = await comprador.rpc(
    "open_purchase_round",
    { p_request_ids: [requisicao], p_name: "Rodada do teste" }
  );
  expect(erroRodada, erroRodada?.message).toBeNull();

  const { rows: itensRodada } = await db.query(
    `select id, requested_quantity from public.purchase_round_items
      where round_id = $1`,
    [rodada]
  );
  expect(itensRodada.length).toBeGreaterThan(0);
  const linha = itensRodada[0];

  // ---- 3. dois fornecedores, e só um responde ------------------------------
  const { rows: fornecedores } = await db.query(
    "select id, name from public.suppliers where clinic_id = $1 order by name limit 2",
    [cambe]
  );
  expect(fornecedores).toHaveLength(2);
  const [respondeu, calou] = fornecedores;

  const { data: cotacaoA } = await comprador.rpc("save_purchase_quote", {
    p_round_id: rodada,
    p_supplier_id: respondeu.id,
    p_delivery_days: 5,
  });
  // O segundo fornecedor ENTRA na mesa e não manda preço — é esse o cenário.
  // A cotação dele existe, vazia; o retorno não interessa.
  await comprador.rpc("save_purchase_quote", {
    p_round_id: rodada,
    p_supplier_id: calou.id,
    p_delivery_days: 10,
  });

  // Só o primeiro manda preço. O segundo abriu a cotação e não respondeu.
  const { error: erroPreco } = await comprador.rpc("save_quote_price", {
    p_quote_id: cotacaoA,
    p_round_item_id: linha.id,
    p_unit_cents: 2000,
  });
  expect(erroPreco, erroPreco?.message).toBeNull();

  // ---- A PROVA: quem não cotou NÃO pode ser escolhido ----------------------
  const { error: erroEscolhaVazia } = await comprador.rpc("award_round_item", {
    p_round_item_id: linha.id,
    p_supplier_id: calou.id,
  });
  expect(erroEscolhaVazia?.message ?? "").toContain("SUPPLIER_DID_NOT_QUOTE");

  // E quem cotou, pode.
  const { error: erroEscolha } = await comprador.rpc("award_round_item", {
    p_round_item_id: linha.id,
    p_supplier_id: respondeu.id,
  });
  expect(erroEscolha, erroEscolha?.message).toBeNull();

  const { error: erroFechar } = await comprador.rpc("close_purchase_round", {
    p_round_id: rodada,
  });
  expect(erroFechar, erroFechar?.message).toBeNull();

  // ---- 4. a unidade aprova a parte dela ------------------------------------
  // Silêncio não vira aprovação: sem decisão, o pedido não nasce. É dinheiro da
  // unidade, e quem decide é quem paga.
  const { rows: partes } = await db.query(
    `select a.id from public.purchase_allocations a
       join public.purchase_round_items ri on ri.id = a.round_item_id
      where ri.round_id = $1 and a.clinic_id = $2`,
    [rodada, cambe]
  );
  expect(partes.length).toBeGreaterThan(0);

  for (const parte of partes) {
    const { error } = await gerente.rpc("decide_allocation", {
      p_allocation_id: parte.id,
      p_approved: true,
    });
    expect(error, error?.message).toBeNull();
  }

  const { error: erroPedidos } = await gerente.rpc("create_orders_from_round", {
    p_round_id: rodada,
    p_clinic_id: cambe,
  });
  expect(erroPedidos, erroPedidos?.message).toBeNull();

  const { rows: ordens } = await db.query(
    `select id, code, status from public.purchase_orders
      where clinic_id = $1 and round_id = $2`,
    [cambe, rodada]
  );
  expect(ordens).toHaveLength(1);
  expect(ordens[0].code).toMatch(/^PD-/);

  // ---- 5. o recebimento, com a NOTA divergindo do pedido -------------------
  const { rows: linhasPedido } = await db.query(
    `select id, quantity, unit_cents from public.purchase_order_items
      where order_id = $1`,
    [ordens[0].id]
  );
  const linhaPedido = linhasPedido[0];
  const precoDaNota = Number(linhaPedido.unit_cents) + 300; // chegou mais caro

  const { error: erroReceb } = await gerente.rpc("receive_purchase_order", {
    p_order_id: ordens[0].id,
    p_invoice_number: "NF-TESTE-001",
    p_issue_date: new Date().toISOString().slice(0, 10),
    // Chaves em CAMELO — é o padrão do sistema (mesma pegadinha do kit, que
    // espera `itemId`). Com o nome errado o banco recusa, e recusa é melhor que
    // gravar um recebimento pela metade.
    p_items: [
      {
        orderItemId: linhaPedido.id,
        quantity: Number(linhaPedido.quantity),
        unitCents: precoDaNota,
      },
    ],
    // Mesmo formato do Estoque: [{ amountCents, dueDate }].
    p_installments: [
      {
        dueDate: new Date().toISOString().slice(0, 10),
        amountCents: Math.round(Number(linhaPedido.quantity) * precoDaNota),
      },
    ],
  });
  expect(erroReceb, erroReceb?.message).toBeNull();

  // A NOTA MANDOU: o preço que entrou é o dela, e o do pedido ficou congelado
  // ao lado como evidência da divergência.
  const { rows: recebido } = await db.query(
    `select ri.unit_cents, ri.ordered_unit_cents
       from public.purchase_receipt_items ri
       join public.purchase_receipts r on r.id = ri.receipt_id
      where r.order_id = $1`,
    [ordens[0].id]
  );
  expect(recebido).toHaveLength(1);
  expect(Number(recebido[0].unit_cents)).toBe(precoDaNota);
  expect(Number(recebido[0].ordered_unit_cents)).toBe(
    Number(linhaPedido.unit_cents)
  );

  // E o material chegou à prateleira: comprar vira ESTOQUE, não despesa.
  const { rows: saldo } = await db.query(
    `select coalesce(quantity, 0) + coalesce(in_use_quantity, 0) as total
       from public.stock_balances where clinic_id = $1 and item_id = $2`,
    [cambe, item]
  );
  expect(Number(saldo[0]?.total ?? 0)).toBeGreaterThan(0);

  await db.end();
});
