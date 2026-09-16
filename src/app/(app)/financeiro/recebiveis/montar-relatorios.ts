import "server-only";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { fileName } from "@/lib/print";
import {
  COLLECTION_OUTCOME_LABELS,
  rotuloDoPeriodo,
  situacaoDaMargem,
  type Inadimplente,
} from "@/lib/finance/collection";
import type { RelatorioPronto } from "@/lib/finance/relatorio";
import type { LinhaRecebivel } from "./dados";

/**
 * OS TRÊS RELATÓRIOS DO FINANCEIRO (relato OC-00009).
 *
 * Aqui os dados das telas viram o MODELO de relatório; quem desenha é a página
 * de impressão ou o gerador de planilha. Montar isto num lugar só é o que
 * garante que o PDF e a planilha digam a mesma coisa — na primeira entrega
 * eram duas montagens, e elas divergiram.
 */

const dataLegivel = (iso: string) => formatBrDate(`${iso}T12:00:00`);

function metadadosComuns(
  unidade: string,
  periodo: string,
  quem: string | null
): RelatorioPronto["metadados"] {
  return [
    { rotulo: "Unidade", valor: unidade },
    { rotulo: "Período", valor: periodo },
    { rotulo: "Gerado em", valor: formatBrDateTime(new Date()) },
    ...(quem ? [{ rotulo: "Gerado por", valor: quem }] : []),
  ];
}

// -----------------------------------------------------------------------------
// 1) Inadimplentes — a lista de cobrança
// -----------------------------------------------------------------------------
export function relatorioDeInadimplentes(input: {
  fila: Inadimplente[];
  unidade: string;
  de: string | null;
  ate: string | null;
  quem: string | null;
  taxaPercent: number | null;
  limitePercent: number | null;
  semCliente: number;
}): RelatorioPronto {
  const periodo = rotuloDoPeriodo(input.de, input.ate, dataLegivel);
  const total = input.fila.reduce((s, p) => s + p.vencidoCents, 0);
  const semTelefone = input.fila.filter((p) => !p.telefone).length;
  const contatados = input.fila.filter((p) => p.totalDeContatos > 0).length;

  const notas = [
    "O valor devedor é o de hoje: principal, benefício perdido, multa e juros — a mesma conta da ficha do paciente.",
    "Quem tem apenas parcela a vencer não aparece: a vencer não é atraso.",
    "A taxa de inadimplência é sempre da unidade inteira. Quando há filtro de período, os totais desta lista são do recorte, não da unidade.",
    "O limite é o percentual que a rede definiu em Financeiro → Configuração. Não é uma referência de mercado.",
  ];
  if (input.semCliente > 0) {
    notas.push(
      `${input.semCliente} cobrança(s) vencida(s) não entram nesta lista por não terem paciente vinculado — sem pessoa não há para quem ligar.`
    );
  }
  if (semTelefone > 0) {
    notas.push(
      `${semTelefone} pessoa(s) estão sem telefone no cadastro e aparecem marcadas: não é possível ligar até alguém completar a ficha.`
    );
  }

  return {
    titulo: "Relatório de inadimplentes",
    subtitulo: "Fila de cobrança — uma linha por pessoa",
    metadados: metadadosComuns(input.unidade, periodo, input.quem),
    resumo: [
      { rotulo: "Pessoas a cobrar", valor: String(input.fila.length) },
      {
        rotulo: "Total a cobrar",
        valor: (total / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
      },
      {
        rotulo: "Já contatadas",
        valor: `${contatados} de ${input.fila.length}`,
      },
      {
        rotulo: "Inadimplência da unidade",
        valor:
          input.taxaPercent === null
            ? "sem base para calcular"
            : `${input.taxaPercent.toLocaleString("pt-BR")}%`,
      },
    ],
    situacao: situacaoDaMargem(input.taxaPercent, input.limitePercent),
    colunas: [
      { chave: "paciente", titulo: "Paciente", tipo: "texto", largura: 32 },
      { chave: "telefone", titulo: "Telefone", tipo: "texto", largura: 18 },
      {
        chave: "devido",
        titulo: "Valor devedor",
        tipo: "dinheiro",
        somar: true,
        largura: 16,
      },
      { chave: "cobrancas", titulo: "Cobranças", tipo: "numero", largura: 11 },
      { chave: "atraso", titulo: "Atraso (dias)", tipo: "numero", largura: 13 },
      { chave: "aVencer", titulo: "A vencer", tipo: "dinheiro", largura: 14 },
      { chave: "contato", titulo: "Último contato", tipo: "texto", largura: 24 },
      { chave: "quando", titulo: "Quando", tipo: "texto", largura: 17 },
      { chave: "prometeu", titulo: "Prometeu pagar", tipo: "texto", largura: 15 },
      { chave: "obs", titulo: "Observação", tipo: "texto", largura: 38 },
    ],
    linhas: input.fila.map((p) => ({
      paciente: p.cliente,
      // Sem telefone é a informação, não um vazio: é o que trava a cobrança.
      telefone: p.telefone ?? "SEM TELEFONE NO CADASTRO",
      devido: p.vencidoCents,
      cobrancas: p.quantidadeVencida,
      atraso: p.diasDoMaisAntigo,
      aVencer: p.aVencerCents > 0 ? p.aVencerCents : null,
      contato: p.ultimoContato
        ? COLLECTION_OUTCOME_LABELS[p.ultimoContato.outcome]
        : "nunca contatado",
      quando: p.ultimoContato
        ? formatBrDateTime(p.ultimoContato.contactedAt)
        : null,
      prometeu: p.ultimoContato?.promisedDate
        ? dataLegivel(p.ultimoContato.promisedDate)
        : null,
      obs: p.ultimoContato?.note ?? null,
    })),
    notas,
    nomeDoArquivo: fileName("risarte", "inadimplentes", input.unidade),
  };
}

// -----------------------------------------------------------------------------
// 2) Recebíveis — a visão de conferência
// -----------------------------------------------------------------------------
export function relatorioDeRecebiveis(input: {
  linhas: LinhaRecebivel[];
  unidade: string;
  de: string | null;
  ate: string | null;
  quem: string | null;
  abertoCents: number;
  vencidoCents: number;
  taxaPercent: number | null;
  limitePercent: number | null;
  recebidoNoMesCents: number;
}): RelatorioPronto {
  const periodo = rotuloDoPeriodo(input.de, input.ate, dataLegivel);
  const brl = (c: number) =>
    (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return {
    titulo: "Relatório de recebíveis",
    subtitulo: "Cobranças em aberto — uma linha por cobrança",
    metadados: metadadosComuns(input.unidade, periodo, input.quem),
    resumo: [
      { rotulo: "A receber", valor: brl(input.abertoCents) },
      { rotulo: "Vencido (só principal)", valor: brl(input.vencidoCents) },
      { rotulo: "Recebido no mês", valor: brl(input.recebidoNoMesCents) },
      {
        rotulo: "Inadimplência",
        valor:
          input.taxaPercent === null
            ? "sem base para calcular"
            : `${input.taxaPercent.toLocaleString("pt-BR")}%`,
      },
    ],
    situacao: situacaoDaMargem(input.taxaPercent, input.limitePercent),
    colunas: [
      { chave: "paciente", titulo: "Paciente", tipo: "texto", largura: 34 },
      { chave: "vencimento", titulo: "Vencimento", tipo: "data", largura: 14 },
      {
        chave: "falta",
        titulo: "Falta (principal)",
        tipo: "dinheiro",
        somar: true,
        largura: 18,
      },
      {
        chave: "comEncargos",
        titulo: "Com multa e juros",
        tipo: "dinheiro",
        largura: 18,
      },
      { chave: "situacao", titulo: "Situação", tipo: "texto", largura: 12 },
      { chave: "atraso", titulo: "Atraso (dias)", tipo: "numero", largura: 13 },
    ],
    linhas: input.linhas.map((l) => ({
      paciente: l.cliente,
      vencimento: l.dataEfetiva,
      falta: l.balanceCents,
      // ⚠️ Em dia NÃO repete o principal aqui: sugeriria encargo correndo.
      comEncargos: l.isLate ? l.updatedBalanceCents : null,
      situacao: l.isLate ? "Vencida" : "Em dia",
      atraso: l.isLate ? l.daysLate : null,
    })),
    notas: [
      "Entram só as cobranças que ainda devem alguma coisa. Paga, cancelada ou substituída por renegociação fica na ficha do paciente.",
      "Cartão não conta como atrasado enquanto não liquida: a adquirente paga em D+30, e a data usada aqui é a de liquidação.",
      "O vencido do resumo é só o principal — é ele que a taxa de inadimplência compara com o total a receber. O valor de cobrança, com multa e juros, está na coluna própria e no relatório de inadimplentes.",
      "O limite é o percentual que a rede definiu. Não é uma referência de mercado.",
    ],
    nomeDoArquivo: fileName("risarte", "recebiveis", input.unidade),
  };
}

// -----------------------------------------------------------------------------
// 3) Rede — o quadro de todas as unidades
// -----------------------------------------------------------------------------
export function relatorioDaRede(input: {
  unidades: {
    nome: string;
    ownership: "own" | "franchised";
    abertoCents: number;
    vencidoCents: number;
    vencidoQuantidade: number;
    taxaPercent: number | null;
    limitePercent: number | null;
  }[];
  quem: string | null;
  totalAbertoCents: number;
  totalVencidoCents: number;
  taxaDaRede: number | null;
  acimaDoLimite: number;
}): RelatorioPronto {
  const brl = (c: number) =>
    (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return {
    titulo: "Relatório de recebíveis da rede",
    subtitulo: "Todas as unidades lado a lado",
    metadados: [
      { rotulo: "Gerado em", valor: formatBrDateTime(new Date()) },
      ...(input.quem ? [{ rotulo: "Gerado por", valor: input.quem }] : []),
      { rotulo: "Unidades", valor: String(input.unidades.length) },
    ],
    resumo: [
      { rotulo: "A receber na rede", valor: brl(input.totalAbertoCents) },
      { rotulo: "Vencido na rede", valor: brl(input.totalVencidoCents) },
      {
        rotulo: "Inadimplência da rede",
        valor:
          input.taxaDaRede === null
            ? "sem base para calcular"
            : `${input.taxaDaRede.toLocaleString("pt-BR")}%`,
      },
      { rotulo: "Acima do limite", valor: String(input.acimaDoLimite) },
    ],
    situacao:
      input.acimaDoLimite === 0
        ? "Nenhuma unidade passou do próprio limite."
        : input.acimaDoLimite === 1
          ? "1 unidade passou do limite que a rede definiu para ela."
          : `${input.acimaDoLimite} unidades passaram do limite que a rede definiu para elas.`,
    colunas: [
      { chave: "unidade", titulo: "Unidade", tipo: "texto", largura: 28 },
      { chave: "tipo", titulo: "Tipo", tipo: "texto", largura: 12 },
      {
        chave: "aReceber",
        titulo: "A receber",
        tipo: "dinheiro",
        somar: true,
        largura: 16,
      },
      {
        chave: "vencido",
        titulo: "Vencido",
        tipo: "dinheiro",
        somar: true,
        largura: 16,
      },
      { chave: "qtd", titulo: "Cobranças", tipo: "numero", somar: true, largura: 11 },
      { chave: "taxa", titulo: "Taxa", tipo: "texto", largura: 10 },
      { chave: "limite", titulo: "Limite", tipo: "texto", largura: 10 },
      { chave: "situacao", titulo: "Situação", tipo: "texto", largura: 34 },
    ],
    linhas: input.unidades.map((u) => ({
      unidade: u.nome,
      tipo: u.ownership === "own" ? "Própria" : "Franqueada",
      aReceber: u.abertoCents,
      vencido: u.vencidoCents,
      qtd: u.vencidoQuantidade,
      // Texto, e não número: "sem base" não é um percentual, e um 0 aqui seria
      // lido como "em dia".
      taxa:
        u.taxaPercent === null
          ? "sem base"
          : `${u.taxaPercent.toLocaleString("pt-BR")}%`,
      limite:
        u.limitePercent === null
          ? "não definido"
          : `${u.limitePercent.toLocaleString("pt-BR")}%`,
      situacao:
        u.taxaPercent === null
          ? "Nada a receber"
          : u.limitePercent === null
            ? "Sem limite definido"
            : u.taxaPercent > u.limitePercent
              ? "ACIMA do limite"
              : "Dentro do limite",
    })),
    notas: [
      "A inadimplência da rede é o vencido de todas dividido pelo que todas têm a receber — não a média das taxas. Na média, uma unidade pequena com tudo vencido pesaria igual à maior da rede.",
      "O limite de cada unidade vem da cascata rede → unidade, em Financeiro → Configuração. Não é uma referência de mercado.",
      "Unidade sem nada a receber aparece sem taxa: não há o que medir, e um 0% seria lido como “em dia”.",
    ],
    nomeDoArquivo: fileName("risarte", "recebiveis-da-rede"),
  };
}
