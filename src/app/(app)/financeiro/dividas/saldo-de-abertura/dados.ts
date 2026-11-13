import "server-only";
import { getSessionContext } from "@/lib/auth";
import { formatBrDateTime, formatIsoDateBr } from "@/lib/dates";
import { formatCnpj, formatCpf } from "@/lib/masks";
import { podeVerDividas } from "@/lib/finance/dividas-acesso";
import { relatorioDoSaldoDeAbertura, type DividaDoSaldo } from "@/lib/finance/dividas-saldo-de-abertura";
import type { RelatorioPronto } from "@/lib/finance/relatorio";
import { carregarBase, carregarDividas, carregarTitulosDasDividas, type BaseDasDividas } from "../dados";

/**
 * O relatório de saldo de abertura de UM devedor (CNPJ). A página de
 * impressão e a planilha leem daqui — um carregador, duas saídas.
 * `null` = sem permissão; `falhou` = não deu para ler tudo (não sai pela metade).
 */
export async function carregarSaldoDeAbertura(
  params: Record<string, string | string[] | undefined>
): Promise<
  | null
  | { falhou: true }
  | { escolher: BaseDasDividas["devedores"] }
  | { relatorio: RelatorioPronto }
> {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) return null;
  const clinica = typeof params.clinica === "string" ? params.clinica : "";

  const base = await carregarBase();
  if (base.semMigracao) return { falhou: true };
  const devedor = base.devedores.find((d) => d.id === clinica);
  if (!devedor) return { escolher: base.devedores };

  const [lista, titulos] = await Promise.all([carregarDividas(), carregarTitulosDasDividas()]);
  if (!lista.ok || !titulos.ok) return { falhou: true };

  const categoria = new Map(base.categorias.map((c) => [c.id, c]));
  const credor = new Map(base.credores.map((c) => [c.id, c]));
  const nomeDaConta = new Map(base.contas.map((a) => [a.code, a.name]));

  const dividas: DividaDoSaldo[] = lista.dividas
    .filter((d) => d.clinicId === devedor.id && d.origin === "A")
    .map((d) => {
      const cat = d.categoryId ? categoria.get(d.categoryId) : undefined;
      const sub = d.subcategoryId ? categoria.get(d.subcategoryId) : undefined;
      // A mesma escolha de conta de `_debt_title_spec` (0406) para a origem A.
      const conta = d.accountCode ?? cat?.contaAbertura ?? "5.5.01";
      const doFinanceiro = titulos.titulos.get(d.id) ?? [];
      const c = credor.get(d.supplierId);
      return {
        code: d.code,
        credor: c?.nome ?? "—",
        documentoDoCredor: documento(c?.documento ?? null),
        categoria: cat ? (sub ? `${cat.nome} › ${sub.nome}` : cat.nome) : null,
        conta,
        nomeDaConta: nomeDaConta.get(conta) ?? null,
        contrato: d.contractNumber,
        emissao: d.issueDate,
        vencimento: d.dueDate,
        originalCents: d.originalCents,
        saldoCents: d.updatedCents ?? d.originalCents ?? 0,
        pagoCents: doFinanceiro.reduce((a, t) => a + t.pagoCents, 0),
        noFinanceiro: doFinanceiro.length > 0,
      };
    });

  return {
    relatorio: relatorioDoSaldoDeAbertura({
      devedor: devedor.razaoSocial ?? devedor.nome,
      cnpj: devedor.cnpj ? formatCnpj(devedor.cnpj) : null,
      implantacao: devedor.implantacao,
      dividas,
      geradoEm: formatBrDateTime(new Date()),
      geradoPor: session.fullName,
      formatarData: formatIsoDateBr,
    }),
  };
}

/** CNPJ ou CPF do credor com a máscara (o cadastro guarda só os dígitos). */
function documento(v: string | null): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return formatCnpj(d);
  if (d.length === 11) return formatCpf(d);
  return v;
}
