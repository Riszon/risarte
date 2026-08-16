"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import {
  canManageStock,
  canManageStockCatalog,
  canConsumeStock,
} from "@/lib/stock-access";
import { movementErrors, type MovementKind } from "@/lib/stock";

export type StockResult = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/estoque");
  // O custo de material do kit alimenta o preço e a margem.
  revalidatePath("/procedimentos");
  revalidatePath("/procedimentos/precificacao");
}

/** Traduz o erro cru do banco para uma frase que quem lê entende. */
function friendly(message: string, fallback: string): string {
  if (message.includes("NOT_ALLOWED")) {
    return "Sua função não permite esta operação no estoque.";
  }
  if (message.includes("INVALID_QUANTITY")) {
    return "A quantidade precisa ser maior que zero.";
  }
  return fallback;
}

// -- CATÁLOGO (rede) ---------------------------------------------------------

export async function saveStockItem(input: {
  id: string | null;
  name: string;
  brand: string;
  /** Unidade de CONTROLE — em que o saldo vive e o kit consome. */
  unitOfMeasure: string;
  /** Embalagem em que se compra. */
  purchaseUnit: string;
  /** Quantas unidades de controle vêm numa embalagem. */
  unitsPerPurchase: string;
  category: string;
  notes: string;
  isActive: boolean;
  /** 0218: embalagem aberta importa (adesivo, resina). */
  trackOpenPackage: boolean;
  /** 0218: uso geral do atendimento — não entra em kit de procedimento. */
  generalUse: boolean;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStockCatalog(session)) {
    return { ok: false, error: "O catálogo de insumos é da Franqueadora." };
  }
  if (!input.name.trim()) return { ok: false, error: "Informe o nome do item." };

  const factor = Number(input.unitsPerPurchase.replace(",", ".")) || 0;
  if (factor <= 0) {
    // Fator zero ou vazio faria a caixa inteira virar uma unidade — o erro de
    // 100 vezes que a 0214 existe para consertar.
    return {
      ok: false,
      error:
        "Informe quantas unidades de consumo vêm em uma embalagem (1 se for igual).",
    };
  }

  const supabase = await createClient();
  // Quem grava é o banco: a trava da unidade de consumo (0215) é regra de
  // negócio, e regra que importa mora no banco.
  const { error } = await supabase.rpc("save_stock_item", {
    p_id: input.id,
    p_name: input.name,
    p_brand: input.brand,
    p_unit_of_measure: input.unitOfMeasure || "unidade",
    p_purchase_unit: input.purchaseUnit || "unidade",
    p_units_per_purchase: factor,
    p_category: input.category,
    p_notes: input.notes,
    p_active: input.isActive,
    p_track_open_package: input.trackOpenPackage,
    p_general_use: input.generalUse,
  });
  if (error) {
    if (error.message.includes("UNIT_LOCKED")) {
      return {
        ok: false,
        error:
          "Este item já tem saldo ou movimento: a unidade de consumo não pode mudar. Zere o saldo ou cadastre outro item.",
      };
    }
    if (error.message.includes("NAME_REQUIRED")) {
      return { ok: false, error: "Informe o nome do item." };
    }
    console.error("save_stock_item failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível salvar o item."),
    };
  }

  await logAudit({
    action: input.id ? "update" : "create",
    entityType: "stock_item",
    entityId: input.id ?? input.name,
  });
  refresh();
  return { ok: true };
}

/** Excluir = inativar quando o item tem passado (regra do catálogo, 0039). */
export async function removeStockItem(id: string): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStockCatalog(session)) {
    return { ok: false, error: "O catálogo de insumos é da Franqueadora." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_stock_item", { p_id: id });
  if (error) {
    console.error("delete_stock_item failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível excluir o item."),
    };
  }

  await logAudit({ action: "update", entityType: "stock_item", entityId: id });
  refresh();
  // `ok` com mensagem = a tela mostra como aviso, não como erro.
  return data === "inativado"
    ? {
        ok: true,
        error:
          "Item já tem histórico: foi inativado, não excluído. Ele some das listas e o histórico continua inteiro.",
      }
    : { ok: true };
}

// -- MOVIMENTO ---------------------------------------------------------------

export async function postMovement(input: {
  clinicId: string;
  itemId: string;
  kind: MovementKind;
  /** Quantidade na unidade de CONTROLE (consumo, perda, ajuste). */
  quantity: string;
  unitCost: string;
  movementDate: string;
  reason: string;
  /** Entrada pela EMBALAGEM: "1 caixa a R$ 25,00" (o jeito da nota). */
  packages?: string;
  packageCost?: string;
  lotCode?: string;
  expiresAt?: string;
  supplierId?: string;
  invoiceNumber?: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  const byPackage =
    input.kind === "entrada" && (input.packages ?? "").trim() !== "";

  const quantity = Number(
    (byPackage ? (input.packages ?? "") : input.quantity).replace(",", ".")
  );
  const costText = byPackage ? (input.packageCost ?? "") : input.unitCost;
  const unitCostCents = costText.trim() === "" ? null : parseBRLToCents(costText);

  const errors = movementErrors({
    itemId: input.itemId,
    kind: input.kind,
    quantity,
    unitCostCents,
  });
  if (errors.length > 0) return { ok: false, error: errors[0] };

  const isInbound =
    input.kind === "entrada" ||
    input.kind === "ajuste_entrada" ||
    input.kind === "transferencia_entrada";

  const allowed = isInbound
    ? canManageStock(session, input.clinicId)
    : canConsumeStock(session, input.clinicId);
  if (!allowed) {
    return { ok: false, error: "Sua função não permite este lançamento." };
  }

  // Ajuste e perda mudam patrimônio sem nota: sem motivo, ninguém consegue
  // auditar a diferença depois — e a diferença é justamente a informação.
  if (
    (input.kind === "perda" ||
      input.kind === "ajuste_entrada" ||
      input.kind === "ajuste_saida") &&
    input.reason.trim() === ""
  ) {
    return { ok: false, error: "Informe o motivo do ajuste ou da perda." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_stock_movement", {
    p_clinic_id: input.clinicId,
    p_item_id: input.itemId,
    p_kind: input.kind,
    // Quem converte embalagem → consumo é o BANCO: a mesma conta vale para a
    // nota digitada hoje e para a integração de compras amanhã.
    p_quantity: byPackage ? null : quantity,
    p_unit_cost_cents: byPackage ? null : unitCostCents,
    p_movement_date: input.movementDate || null,
    p_reason: input.reason.trim() || null,
    p_source_type: "manual",
    p_source_id: null,
    p_purchase_quantity: byPackage ? quantity : null,
    p_purchase_unit_cost_cents: byPackage ? unitCostCents : null,
    p_lot_code: input.lotCode?.trim() || null,
    p_expires_at: input.expiresAt || null,
    p_supplier_id: input.supplierId || null,
    p_invoice_number: input.invoiceNumber?.trim() || null,
  });
  if (error) {
    console.error("post_stock_movement failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível lançar o movimento."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "stock_movement",
    entityId: input.itemId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
}

// -- NOTA FISCAL POR XML (0223) ----------------------------------------------

/**
 * Resolve as linhas da nota contra o que já se sabe.
 *
 * GTIN primeiro (vale entre fornecedores), depois o vínculo daquele fornecedor.
 * A descrição NÃO entra aqui de propósito: casar por nome é a maneira certa de
 * gravar material errado dando baixa em procedimento errado.
 */
export async function resolveNfeItems(input: {
  cnpj: string;
  codes: string[];
  gtins: string[];
}): Promise<{
  byGtin: Record<string, string>;
  bySupplierCode: Record<string, string>;
}> {
  await getSessionContext();
  const supabase = await createClient();

  const gtins = input.gtins.filter(Boolean);
  const [{ data: itemRows }, { data: linkRows }] = await Promise.all([
    gtins.length
      ? supabase.from("stock_items").select("id, gtin").in("gtin", gtins)
      : Promise.resolve({ data: [] as { id: string; gtin: string }[] }),
    supabase
      .from("supplier_item_links")
      .select("supplier_code, item_id")
      .eq("supplier_cnpj", input.cnpj.replace(/\D/g, ""))
      .in("supplier_code", input.codes),
  ]);

  const byGtin: Record<string, string> = {};
  for (const r of itemRows ?? []) {
    if (r.gtin) byGtin[r.gtin as string] = r.id as string;
  }
  const bySupplierCode: Record<string, string> = {};
  for (const r of linkRows ?? []) {
    bySupplierCode[r.supplier_code as string] = r.item_id as string;
  }
  return { byGtin, bySupplierCode };
}

/**
 * Importa a nota conferida.
 *
 * O XML vai para o Storage porque é documento fiscal — permite reconferir a
 * origem de qualquer número depois. E a chave da NF-e trava a duplicidade no
 * banco: subir o mesmo arquivo de novo dobraria estoque e conta a pagar.
 */
export async function importNfe(input: {
  clinicId: string;
  supplierId: string;
  costCenterId: string;
  nfeKey: string;
  invoiceNumber: string;
  issueDate: string;
  supplierCnpj: string;
  xml: string;
  items: {
    itemId: string;
    packages: string;
    packageCostCents: number;
    supplierCode: string;
    supplierDescription: string;
    gtin: string;
  }[];
  installments: { dueDate: string; amountCents: number }[];
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Sua função não permite importar notas." };
  }
  if (input.items.length === 0) {
    return { ok: false, error: "Aponte o item de cada linha antes de lançar." };
  }

  const supabase = await createClient();

  // O arquivo primeiro: se o Storage falhar, ninguém lançou nada ainda.
  const path = `${input.clinicId}/${input.nfeKey || Date.now()}.xml`;
  const { error: upErr } = await supabase.storage
    .from("nfe")
    .upload(path, new Blob([input.xml], { type: "text/xml" }), {
      upsert: true,
      contentType: "text/xml",
    });
  if (upErr) {
    // Guardar o XML é desejável, não essencial: o lançamento não pode ficar
    // refém do arquivo. Segue e registra o que faltou.
    console.error("upload do XML da NF-e falhou:", upErr.message);
  }

  const { error } = await supabase.rpc("register_stock_purchase", {
    p_clinic_id: input.clinicId,
    p_supplier_id: input.supplierId || null,
    p_invoice_number: input.invoiceNumber,
    p_issue_date: input.issueDate || null,
    p_items: input.items.map((i) => ({
      itemId: i.itemId,
      packages: Number(i.packages.replace(",", ".")) || 0,
      packageCostCents: i.packageCostCents,
      supplierCode: i.supplierCode,
      supplierCnpj: input.supplierCnpj,
      supplierDescription: i.supplierDescription,
      gtin: i.gtin,
    })),
    p_installments: input.installments,
    p_cost_center_id: input.costCenterId || null,
    p_notes: null,
    p_nfe_key: input.nfeKey,
    p_xml_path: upErr ? null : path,
  });
  if (error) {
    if (error.message.includes("NFE_ALREADY_IMPORTED")) {
      return {
        ok: false,
        error:
          "Esta nota já foi importada nesta unidade — importar de novo dobraria o estoque e a conta a pagar.",
      };
    }
    console.error("importNfe failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível importar a nota."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "stock_purchase_nfe",
    entityId: input.nfeKey || input.invoiceNumber,
    clinicId: input.clinicId,
  });
  refresh();
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

// -- INVENTÁRIO (0222) -------------------------------------------------------

/** Abre a contagem já com o esperado CONGELADO item a item. */
export async function openCount(input: {
  clinicId: string;
  onlyWithBalance: boolean;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Só a gestão faz inventário." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_stock_count", {
    p_clinic_id: input.clinicId,
    p_only_with_balance: input.onlyWithBalance,
  });
  if (error) {
    if (error.message.includes("COUNT_ALREADY_OPEN")) {
      return {
        ok: false,
        error: "Já existe uma contagem aberta nesta unidade.",
      };
    }
    console.error("open_stock_count failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível abrir a contagem."),
    };
  }
  refresh();
  return { ok: true };
}

export async function saveCountLine(input: {
  clinicId: string;
  lineId: string;
  counted: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Só a gestão faz inventário." };
  }

  const value =
    input.counted.trim() === ""
      ? null
      : Number(input.counted.replace(",", "."));
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return { ok: false, error: "Quantidade contada inválida." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("stock_count_items")
    .update({ counted_quantity: value })
    .eq("id", input.lineId);
  if (error) {
    console.error("saveCountLine failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a contagem do item." };
  }
  refresh();
  return { ok: true };
}

/**
 * Aplica a contagem: cada diferença vira um ajuste COM MOTIVO.
 *
 * A diferença não é um erro a apagar — ela mede perda, furto, kit mal
 * cadastrado e consumo fora do previsto. Por isso vira movimento, e não uma
 * correção silenciosa do saldo.
 */
export async function applyCount(input: {
  clinicId: string;
  countId: string;
  reason: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Só a gestão faz inventário." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_stock_count", {
    p_count_id: input.countId,
    p_reason: input.reason,
  });
  if (error) {
    if (error.message.includes("COUNT_NOT_OPEN")) {
      return { ok: false, error: "Esta contagem já foi aplicada ou descartada." };
    }
    console.error("apply_stock_count failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível aplicar a contagem."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "stock_count",
    entityId: input.countId,
    clinicId: input.clinicId,
  });
  refresh();
  return {
    ok: true,
    error:
      Number(data ?? 0) === 0
        ? "Contagem aplicada — nenhuma diferença encontrada."
        : undefined,
  };
}

export async function discardCount(input: {
  clinicId: string;
  countId: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Só a gestão faz inventário." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_stock_count", {
    p_count_id: input.countId,
  });
  if (error) {
    console.error("discard_stock_count failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível descartar a contagem."),
    };
  }
  refresh();
  return { ok: true };
}

/**
 * 0221 — a nota de compra: entradas de estoque e contas a pagar de uma vez.
 *
 * COMPRAR NÃO É GASTAR. A conta a pagar nasce classificada em 6.1.01 (ativo) e
 * não toca o resultado; o custo só aparece quando o material for usado. Tudo
 * numa transação: se a conta a pagar falhasse depois das entradas, o estoque
 * subiria sem a obrigação e a conferência nunca mais fecharia.
 */
export async function registerPurchase(input: {
  clinicId: string;
  supplierId: string;
  invoiceNumber: string;
  issueDate: string;
  costCenterId: string;
  notes: string;
  items: {
    itemId: string;
    packages: string;
    packageCost: string;
    lotCode: string;
    expiresAt: string;
  }[];
  installments: { dueDate: string; amount: string }[];
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Sua função não permite registrar compras." };
  }

  const items = input.items
    .map((l) => ({
      itemId: l.itemId,
      packages: Number(l.packages.replace(",", ".")) || 0,
      packageCostCents: parseBRLToCents(l.packageCost) ?? 0,
      lotCode: l.lotCode.trim() || null,
      expiresAt: l.expiresAt || null,
    }))
    .filter((l) => l.itemId && l.packages > 0);

  if (items.length === 0) {
    return { ok: false, error: "Informe ao menos um item com quantidade." };
  }
  if (items.some((l) => l.packageCostCents <= 0)) {
    // Entrada sem valor destrói o custo médio em silêncio.
    return { ok: false, error: "Informe o valor de cada item da nota." };
  }

  const total = items.reduce(
    (s, l) => s + Math.round(l.packages * l.packageCostCents),
    0
  );

  const installments = input.installments
    .map((p) => ({
      dueDate: p.dueDate,
      amountCents: parseBRLToCents(p.amount) ?? 0,
    }))
    .filter((p) => p.dueDate && p.amountCents > 0);

  if (installments.length === 0) {
    return { ok: false, error: "Informe ao menos um vencimento." };
  }

  const parcels = installments.reduce((s, p) => s + p.amountCents, 0);
  if (parcels !== total) {
    // Parcelas que não fecham com a nota deixariam ativo e obrigação
    // discordando desde o primeiro dia.
    return {
      ok: false,
      error: `As parcelas somam ${(parcels / 100).toFixed(2)} e a nota soma ${(total / 100).toFixed(2)}.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_stock_purchase", {
    p_clinic_id: input.clinicId,
    p_supplier_id: input.supplierId || null,
    p_invoice_number: input.invoiceNumber,
    p_issue_date: input.issueDate || null,
    p_items: items,
    p_installments: installments,
    p_cost_center_id: input.costCenterId || null,
    p_notes: input.notes,
  });
  if (error) {
    if (error.message.includes("NO_ITEMS")) {
      return { ok: false, error: "Informe ao menos um item." };
    }
    if (error.message.includes("NO_INSTALLMENTS")) {
      return { ok: false, error: "Informe ao menos um vencimento." };
    }
    console.error("register_stock_purchase failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível registrar a nota."),
    };
  }

  await logAudit({
    action: "create",
    entityType: "stock_purchase",
    entityId: input.invoiceNumber || input.clinicId,
    clinicId: input.clinicId,
  });
  refresh();
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

/**
 * 0219 — abrir embalagem é ato de GENTE.
 *
 * O consumo do kit é estimativa: ele não sabe se o frasco acabou. Por isso o
 * sistema deixou de abrir sozinho — quem olha a bancada decide. E a troca é o
 * momento em que a estimativa se acerta com a realidade: a sobra (ou a falta)
 * da embalagem anterior vira ajuste com motivo, em vez de ser arrastada.
 */
export async function openPackage(input: {
  clinicId: string;
  itemId: string;
  packages: number;
  previousFinished: boolean;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canConsumeStock(session, input.clinicId)) {
    return { ok: false, error: "Sua função não permite abrir embalagem." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_stock_package", {
    p_clinic_id: input.clinicId,
    p_item_id: input.itemId,
    p_packages: Math.max(1, Math.round(input.packages)),
    p_previous_finished: input.previousFinished,
  });
  if (error) {
    if (error.message.includes("NO_CLOSED_PACKAGE")) {
      return {
        ok: false,
        error:
          "Não há embalagem fechada em estoque para abrir. Dê entrada da compra primeiro.",
      };
    }
    if (error.message.includes("NO_BALANCE")) {
      return { ok: false, error: "Este item ainda não tem saldo nesta unidade." };
    }
    console.error("open_stock_package failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível abrir a embalagem."),
    };
  }

  await logAudit({
    action: "update",
    entityType: "stock_open_package",
    entityId: input.itemId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true };
}

/**
 * Mínimo, máximo, onde fica guardado e o fornecedor habitual — tudo isto é DA
 * UNIDADE: Cambé guarda num armário e Londrina noutro, e `suppliers` já é por
 * clínica.
 */
export async function saveItemSettings(input: {
  clinicId: string;
  itemId: string;
  min: string;
  max: string;
  storageLocation: string;
  supplierId: string;
}): Promise<StockResult> {
  const session = await getSessionContext();
  if (!canManageStock(session, input.clinicId)) {
    return { ok: false, error: "Só a gestão define mínimo, máximo e local." };
  }
  const min = Number(input.min.replace(",", ".")) || 0;
  const max = Number(input.max.replace(",", ".")) || 0;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_stock_item_settings", {
    p_clinic_id: input.clinicId,
    p_item_id: input.itemId,
    p_min: min,
    p_max: max,
    p_storage_location: input.storageLocation.trim() || null,
    p_supplier_id: input.supplierId || null,
  });
  if (error) {
    if (error.message.includes("MAX_BELOW_MIN")) {
      return { ok: false, error: "O máximo não pode ser menor que o mínimo." };
    }
    console.error("set_stock_item_settings failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível salvar a configuração."),
    };
  }
  refresh();
  return { ok: true };
}

// -- KIT DO PROCEDIMENTO -----------------------------------------------------

/**
 * 0215 — o kit tem NOME e se liga a vários procedimentos.
 *
 * Itens e vínculos são gravados de uma vez pelo banco: se a lista de itens
 * mudasse sem os vínculos (ou o contrário), um procedimento ficaria ligado a um
 * kit com o conteúdo do estado anterior. Depois recalcula o custo — senão o
 * preço continuaria mostrando a estimativa antiga e ninguém notaria.
 */
export async function saveKit(input: {
  kitId: string | null;
  clinicId: string | null;
  name: string;
  notes: string;
  active: boolean;
  /** 0218: 'procedimento' (por procedimento) ou 'atendimento' (por paciente). */
  kind: "procedimento" | "atendimento";
  lines: { itemId: string; quantity: string }[];
  procedureIds: string[];
}): Promise<StockResult> {
  const session = await getSessionContext();
  const scopeOk =
    input.clinicId === null
      ? canManageStockCatalog(session)
      : canManageStock(session, input.clinicId);
  if (!scopeOk) {
    return {
      ok: false,
      error:
        input.clinicId === null
          ? "O kit padrão da rede é definido pela Franqueadora."
          : "Sua função não permite editar o kit desta unidade.",
    };
  }
  if (!input.name.trim()) return { ok: false, error: "Dê um nome ao kit." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_stock_kit", {
    p_kit_id: input.kitId,
    p_clinic_id: input.clinicId,
    p_name: input.name,
    p_notes: input.notes,
    p_items: input.lines
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity.replace(",", ".")) || 0,
      }))
      .filter((l) => l.itemId && l.quantity > 0),
    p_procedure_ids: input.procedureIds,
    p_active: input.active,
    p_kind: input.kind,
  });
  if (error) {
    if (error.message.includes("NAME_REQUIRED")) {
      return { ok: false, error: "Dê um nome ao kit." };
    }
    console.error("save_stock_kit failed:", error.message);
    return {
      ok: false,
      error: friendly(error.message, "Não foi possível salvar o kit."),
    };
  }

  // 0216: não há mais o que recalcular. O custo de material é CALCULADO na
  // leitura — guardar o resultado foi o que deixou Cambé com R$ 11,69 e Roteiro
  // com R$ 220,00 enquanto o valor real era outro.

  await logAudit({
    action: input.kitId ? "update" : "create",
    entityType: "stock_kit",
    entityId: input.kitId ?? input.name,
    clinicId: input.clinicId ?? undefined,
  });
  refresh();
  return { ok: true };
}
