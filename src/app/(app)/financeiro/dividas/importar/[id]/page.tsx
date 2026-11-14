import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { podeImportarDividas, podeVerDividas } from "@/lib/finance/dividas-acesso";
import { formatInBrazil } from "@/lib/dates";
import { ROTULO_DO_LOTE } from "@/lib/finance/dividas-importacao";
import { carregarContexto, carregarLote, conferenciaGuardada, importadoPorDevedor, reconferir } from "../dados";
import { ConferenciaDoLote, type LinhaDaTela } from "./conferencia";

/**
 * A CONFERÊNCIA de um lote (0407). Em conferência, refeita a cada abertura
 * com o cadastro de agora (células e correções guardadas no banco); gravado,
 * mostra a foto do momento da gravação.
 */
export default async function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) redirect("/financeiro");
  const { id } = await params;
  const [carga, contexto] = await Promise.all([carregarLote(id), carregarContexto()]);
  if (!carga) notFound();
  const { lote } = carga;
  // Em conferência: refeita com o cadastro de agora. Gravado ou desfeito: a
  // foto guardada no momento de gravar (os totais também).
  const emConferencia = lote.status === "conferencia";
  const conf = emConferencia
    ? reconferir(carga.linhas, contexto.ctx)
    : { linhas: conferenciaGuardada(carga.linhas, contexto.ctx.devedores), credoresNovos: [], categoriasNovas: [], totais: lote.totais };
  const idDe = new Map(carga.linhas.map((l) => [`${l.aba}:${l.numero}`, l]));
  const linhas: LinhaDaTela[] = conf.linhas.map((l) => {
    const guardada = idDe.get(`${l.aba}:${l.numero}`)!;
    return { ...l, id: guardada.id, debtId: guardada.debtId };
  });
  // Desfeito: nada mais "entrou" — a coluna de conferência sai, para não acusar diferença.
  const lidoDoLote = lote.status === "importado" ? await importadoPorDevedor(id) : null;
  const importado = lidoDoLote ? Object.fromEntries(lidoDoLote) : null;
  const devedores = contexto.ctx.devedores.map((d) => ({ id: d.id, nome: d.nome }));
  const nomeDoCredor = new Map(contexto.ctx.credores.map((c) => [c.id, c.nome]));

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8">
      <div>
        <Link href="/financeiro/dividas/importar" className="text-sm text-muted-foreground underline">
          ← Importações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {lote.code} — {lote.arquivo}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ROTULO_DO_LOTE[lote.status]} · aberto por {lote.criadoPor ?? "—"} em{" "}
          {formatInBrazil(lote.criadoEm, { dateStyle: "short", timeStyle: "short" })}
          {lote.gravadoEm ? ` · gravado em ${formatInBrazil(lote.gravadoEm, { dateStyle: "short", timeStyle: "short" })}` : ""}
          {lote.desfeitoEm ? ` · desfeito em ${formatInBrazil(lote.desfeitoEm, { dateStyle: "short", timeStyle: "short" })} (${lote.motivoDesfeito})` : ""}
        </p>
      </div>
      {!contexto.ok && (
        <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          Não foi possível ler todo o cadastro agora: a conferência abaixo pode estar incompleta. Recarregue a página.
        </p>
      )}
      <ConferenciaDoLote
        lote={lote}
        linhas={linhas}
        credoresNovos={conf.credoresNovos}
        categoriasNovas={conf.categoriasNovas}
        totais={conf.totais}
        importado={importado}
        podeImportar={podeImportarDividas(session)}
        devedores={devedores}
        credores={contexto.ctx.credores.map((c) => ({ id: c.id, nome: c.nome, documento: c.documento }))}
        titulos={contexto.ctx.titulosLivres.map((t) => ({ ...t, credor: t.fornecedorId ? nomeDoCredor.get(t.fornecedorId) ?? null : null }))}
        dividas={contexto.ctx.dividas.map((d) => ({ id: d.id, code: d.code, clinicId: d.clinicId, credor: nomeDoCredor.get(d.supplierId) ?? "—", valorCents: d.valorCents }))}
      />
    </div>
  );
}
