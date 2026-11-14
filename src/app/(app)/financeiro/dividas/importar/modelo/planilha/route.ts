import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { podeVerDividas } from "@/lib/finance/dividas-acesso";
import { mapeamentoPadrao, CAMPOS_DIVIDAS, CAMPOS_PROTESTOS } from "@/lib/finance/dividas-importacao";

/**
 * A PLANILHA-MODELO da importação (0407): as mesmas colunas do modelo padrão
 * (as da planilha da rede), com listas de escolha nas colunas fechadas e uma
 * aba "Como preencher". Sem nenhuma dívida dentro.
 */
export async function GET() {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) return new NextResponse("Sem permissão.", { status: 403 });
  const supabase = await createClient();
  const [cl, ca, na] = await Promise.all([
    supabase.from("clinics").select("name, cnpj, is_active").order("name"),
    supabase.from("debt_categories").select("name, parent_id, active, sort_order").is("parent_id", null).eq("active", true).order("sort_order"),
    supabase.from("debt_natures").select("label, active, sort_order").eq("active", true).order("sort_order"),
  ]);

  const padrao = mapeamentoPadrao();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risarte Odontologia";
  wb.created = new Date();

  const listas = {
    Devedor: ((cl.data ?? []) as { name: string; is_active: boolean }[]).filter((c) => c.is_active !== false).map((c) => c.name),
    Categoria: ((ca.data ?? []) as { name: string }[]).map((c) => c.name),
    Natureza: ((na.data ?? []) as { label: string }[]).map((n) => n.label),
    Situação: ["Em aberto", "Conta atrasada", "Dívida negativada", "Grupo de dívidas", "Dívida ativa", "Em negociação"],
    "Sim/Não": ["Sim", "Não"],
    "Origem do lançamento": ["A - Anterior à implantação", "B - Nova (após implantação)", "C - Já lançada no Contas a Pagar"],
    "Já está na aba Dívidas?": ["Sim", "Não", "Verificar"],
    "Carta de anuência": ["Pendente", "Solicitada", "Recebida"],
  };

  const cabecalho = (ws: ExcelJS.Worksheet, colunas: string[]) => {
    ws.addRow(colunas);
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
    r.alignment = { vertical: "middle", wrapText: true };
    r.height = 32;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    colunas.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(14, Math.min(40, c.length + 4))));
  };

  const nomesDasListas = Object.keys(listas) as (keyof typeof listas)[];
  const faixa = (n: keyof typeof listas) => {
    const col = String.fromCharCode(65 + nomesDasListas.indexOf(n));
    return `Listas!$${col}$2:$${col}$${Math.max(2, listas[n].length + 1)}`;
  };

  const montar = (nome: string, campos: typeof CAMPOS_DIVIDAS, colunas: Record<string, string>, fechadas: Record<string, keyof typeof listas>, datas: string[], valores: string[]) => {
    const ws = wb.addWorksheet(nome);
    const cols = campos.map((c) => colunas[c.campo]).filter(Boolean);
    cabecalho(ws, cols);
    cols.forEach((col, i) => {
      const campo = campos.find((c) => colunas[c.campo] === col)!.campo;
      const letra = ws.getColumn(i + 1).letter;
      for (let r = 2; r <= 1000; r++) {
        const cell = ws.getCell(`${letra}${r}`);
        if (fechadas[campo]) cell.dataValidation = { type: "list", allowBlank: true, formulae: [faixa(fechadas[campo])] };
        if (datas.includes(campo)) cell.numFmt = "dd/mm/yyyy";
        if (valores.includes(campo)) cell.numFmt = '"R$" #,##0.00';
      }
    });
  };

  montar(
    "Dívidas",
    CAMPOS_DIVIDAS,
    padrao.colunas.dividas,
    { devedor: "Devedor", categoria: "Categoria", natureza: "Natureza", situacao: "Situação", negativada: "Sim/Não", protestada: "Sim/Não", origem: "Origem do lançamento" },
    ["vencimento", "data_referencia", "proposta_validade"],
    ["valor_original", "valor_atualizado", "proposta", "custas"]
  );
  montar(
    "Protestos",
    CAMPOS_PROTESTOS,
    padrao.colunas.protestos,
    { devedor: "Devedor", ja_esta: "Já está na aba Dívidas?", anuencia: "Carta de anuência" },
    ["data"],
    ["valor", "custas"]
  );

  // Aba Listas (as escolhas das colunas fechadas; as validações acima apontam para ela).
  const wl = wb.addWorksheet("Listas");
  cabecalho(wl, nomesDasListas);
  const maior = Math.max(...nomesDasListas.map((n) => listas[n].length));
  for (let i = 0; i < maior; i++) wl.addRow(nomesDasListas.map((n) => listas[n][i] ?? null));

  const wc = wb.addWorksheet("Como preencher");
  wc.getColumn(1).width = 110;
  for (const t of [
    "COMO PREENCHER A PLANILHA DE DÍVIDAS",
    "",
    "Uma linha por dívida na aba Dívidas. O cabeçalho (linha 1) não pode mudar de nome — é por ele que o riSZon acha cada coluna.",
    "Obrigatórios: Credor, Data de vencimento e um valor (original ou atualizado). O devedor é achado pelo CNPJ; sem CNPJ, pelo nome.",
    "CNPJ do credor: os 14 dígitos, ou só a raiz (8 dígitos) quando é o que se tem — o credor entra com a pendência \"completar CNPJ\".",
    "Datas no formato dd/mm/aaaa. Valores em reais (1.234,56).",
    "Data de vencimento é o vencimento real. A data em que a dívida foi levantada vai em \"Data de referência do valor\".",
    "Origem do lançamento: A = dívida de antes da implantação do riSZon (vira saldo de implantação, fora da DRE); B = nova, ainda não lançada (vira despesa); C = já está no Contas a Pagar (só vincula).",
    "Situação \"Grupo de dívidas\": uma linha que junta várias dívidas do mesmo credor. Informe quantas em \"Quantidade reunida\".",
    "Não preencha Desconto, Economia, Tem proposta? nem Valor estimado: o sistema calcula.",
    "",
    "Aba Protestos: uma linha por protesto. Se ele já é de uma dívida da aba Dívidas, \"Já está\" = Sim e o nº (#) dela; se não, \"Não\" (vira dívida nova, protestada); na dúvida, \"Verificar\" (a conferência pede a decisão).",
    "",
    "Na importação, nada é gravado antes da conferência linha a linha — e dá para desfazer enquanto nada foi pago.",
  ]) {
    const r = wc.addRow([t]);
    r.alignment = { wrapText: true };
  }
  wc.getRow(1).font = { bold: true, size: 13 };

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="planilha-modelo-dividas.xlsx"',
      "cache-control": "no-store",
    },
  });
}
