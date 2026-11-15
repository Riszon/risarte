import "server-only";
import { getSessionContext } from "@/lib/auth";
import { formatBrDateTime, todayInBrazil } from "@/lib/dates";
import { podeVerDividas } from "@/lib/finance/dividas-acesso";
import { filtrarDividas, ordenarDividas, type DebtFilters } from "@/lib/finance/dividas";
import { filtroDoEndereco, filtroEmPalavras, relatorioDaListaDeDividas } from "@/lib/finance/dividas-exportacao";
import type { RelatorioPronto } from "@/lib/finance/relatorio";
import {
  carregarBase,
  carregarDividas,
  carregarPosicoes,
  carregarResumoDaFase2,
  carregarTitulosDasDividas,
  linhasDaLista,
  prazosDosSelos,
} from "../dados";

/**
 * Levantamento de Dívidas, fase 7: a lista exportada — as MESMAS linhas,
 * filtro e ordem da tela (lidos do endereço). Nulo = sem permissão.
 */
export async function carregarExportacao(
  params: Record<string, string | string[] | undefined>
): Promise<{ relatorio: RelatorioPronto } | { falhou: true } | null> {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) return null;
  const [base, lista, fase2, titulos, posicoes] = await Promise.all([
    carregarBase(),
    carregarDividas(),
    carregarResumoDaFase2(),
    carregarTitulosDasDividas(),
    carregarPosicoes(),
  ]);
  if (base.semMigracao || !lista.ok || !titulos.ok) return { falhou: true };

  const { filtros, ordem } = filtroDoEndereco(params);
  const hoje = todayInBrazil();
  const linhas = ordenarDividas(
    filtrarDividas(linhasDaLista(lista.dividas, base, fase2, titulos.titulos, posicoes), filtros, hoje, prazosDosSelos(base)),
    ordem
  );
  const nome = (campo: keyof DebtFilters, v: string): string => {
    const achado =
      campo === "devedor" ? base.devedores.find((x) => x.id === v)?.nome
      : campo === "credor" ? base.credores.find((x) => x.id === v)?.nome
      : campo === "categoria" || campo === "subcategoria" ? base.categorias.find((x) => x.id === v)?.nome
      : campo === "natureza" ? base.naturezas.find((x) => x.code === v)?.label
      : campo === "etiqueta" ? base.etiquetas.find((x) => x.id === v)?.nome
      : campo === "responsavel" ? base.responsaveis.find((x) => x.id === v)?.nome
      : undefined;
    return achado ?? v;
  };
  return {
    relatorio: relatorioDaListaDeDividas({
      linhas,
      filtroEmPalavras: filtroEmPalavras(filtros, nome),
      ordem,
      nomeDaCategoria: (id) => (id ? (base.categorias.find((c) => c.id === id)?.nome ?? null) : null),
      geradoEm: formatBrDateTime(new Date()),
      geradoPor: session.fullName,
    }),
  };
}
