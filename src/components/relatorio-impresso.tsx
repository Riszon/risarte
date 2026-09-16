import Image from "next/image";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate } from "@/lib/dates";
import {
  celulaEmTexto,
  totaisDoRelatorio,
  type RelatorioPronto,
} from "@/lib/finance/relatorio";
import { BotaoSalvarPdf } from "./botao-salvar-pdf";

/**
 * O RELATÓRIO NO PAPEL (relato OC-00009, segunda volta).
 *
 * ⚠️ É UM DOCUMENTO, NÃO A TELA IMPRESSA. A primeira entrega mandava imprimir
 * a própria tela, e o dono viu o resultado: *"o PDF ficou parecendo um print
 * da tela do sistema, inclusive aparecendo a lista do topbar"*. Tela tem
 * quadro, barra colorida, filtro e menu — nada disso é relatório.
 *
 * Aqui a página existe só para o papel: fundo branco, tipografia de documento,
 * cabeçalho com a marca, e a tabela com o cabeçalho se repetindo a cada página.
 * O único elemento de tela é o botão de salvar, que sai na impressão.
 */
export function RelatorioImpresso({
  relatorio,
  voltarPara,
}: {
  relatorio: RelatorioPronto;
  voltarPara: string;
}) {
  const totais = totaisDoRelatorio(relatorio);
  const temTotal =
    Object.keys(totais).length > 0 && relatorio.linhas.length > 0;

  return (
    <div className="mx-auto max-w-[900px] bg-white px-8 py-8 text-[#111] print:px-0 print:py-0">
      <div data-moldura className="mb-6 flex flex-wrap items-center gap-2">
        <BotaoSalvarPdf
          nomeDoArquivo={relatorio.nomeDoArquivo}
          voltarPara={voltarPara}
        />
      </div>

      {/* ---- cabeçalho do documento ---- */}
      <header className="avoid-break mb-6 flex items-start justify-between gap-6 border-b-2 border-[#0B1F3A] pb-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight text-[#0B1F3A]">
            {relatorio.titulo}
          </h1>
          {relatorio.subtitulo && (
            <p className="mt-0.5 text-[13px] text-[#555]">
              {relatorio.subtitulo}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            {relatorio.metadados.map((m) => (
              <div key={m.rotulo} className="contents">
                <dt className="font-semibold text-[#0B1F3A]">{m.rotulo}</dt>
                <dd className="text-[#333]">{m.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Image
          src="/marca/odontologia-horizontal.svg"
          alt="Risarte Odontologia"
          width={180}
          height={22}
          className="shrink-0"
          priority
        />
      </header>

      {/* ---- o juízo, em lugar próprio ---- */}
      {relatorio.situacao && (
        <p className="avoid-break mb-5 border-l-4 border-[#0B1F3A] bg-[#F3EFE7] px-3 py-2 text-[13px] font-medium text-[#0B1F3A]">
          {relatorio.situacao}
        </p>
      )}

      {/* ---- resumo ---- */}
      {relatorio.resumo.length > 0 && (
        <section className="avoid-break mb-6 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {relatorio.resumo.map((r) => (
            <div key={r.rotulo}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#777]">
                {r.rotulo}
              </p>
              <p className="text-[15px] font-semibold tabular-nums text-[#0B1F3A]">
                {r.valor}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* ---- a tabela ---- */}
      {relatorio.linhas.length === 0 ? (
        <p className="border py-10 text-center text-[13px] text-[#666]">
          Nenhum registro para este relatório.
        </p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-[#0B1F3A] text-white">
              {relatorio.colunas.map((c) => (
                <th
                  key={c.chave}
                  className={`px-2 py-1.5 font-semibold ${
                    c.tipo === "dinheiro" || c.tipo === "numero"
                      ? "text-right"
                      : "text-left"
                  }`}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {relatorio.linhas.map((linha, i) => (
              <tr
                key={i}
                className="avoid-break border-b border-[#E3E3E3] even:bg-[#FAFAFA]"
              >
                {relatorio.colunas.map((c) => (
                  <td
                    key={c.chave}
                    className={`px-2 py-1 align-top ${
                      c.tipo === "dinheiro" || c.tipo === "numero"
                        ? "whitespace-nowrap text-right tabular-nums"
                        : "text-left"
                    }`}
                  >
                    {celulaEmTexto(linha[c.chave], c.tipo, formatBRL, (iso) =>
                      formatBrDate(`${iso}T12:00:00`)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {temTotal && (
            <tfoot>
              <tr className="border-t-2 border-[#0B1F3A] bg-[#F3EFE7] font-semibold text-[#0B1F3A]">
                {relatorio.colunas.map((c, i) => (
                  <td
                    key={c.chave}
                    className={`px-2 py-1.5 ${
                      c.tipo === "dinheiro" || c.tipo === "numero"
                        ? "whitespace-nowrap text-right tabular-nums"
                        : "text-left"
                    }`}
                  >
                    {c.somar
                      ? c.tipo === "dinheiro"
                        ? formatBRL(totais[c.chave])
                        : totais[c.chave].toLocaleString("pt-BR")
                      : i === 0
                        ? "TOTAL"
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      )}

      {/* ---- notas: o que o relatório NÃO diz ---- */}
      {relatorio.notas.length > 0 && (
        <footer className="mt-6 border-t pt-3">
          <ul className="space-y-1 text-[10px] leading-snug text-[#666]">
            {relatorio.notas.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
