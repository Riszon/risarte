import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FileUp, Landmark } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { GerarPendentes } from "./gerar-pendentes";
import { podeConfigurarDividas, podeImportarDividas, podeLancarDividas, podeVerDividas } from "@/lib/finance/dividas-acesso";
import {
  carregarAcordos,
  carregarBase,
  carregarDividas,
  carregarDreDosDevedores,
  carregarFotografias,
  carregarPosicoes,
  carregarResumoDaFase2,
  carregarTitulosDasDividas,
  linhasDaLista,
  prazosDosSelos,
} from "./dados";
import { AcordosDaRede } from "./acordos-da-rede";
import { PainelDasDividas } from "./painel";
import { ListaDeDividas } from "./lista-de-dividas";
import { Credores } from "./credores";
import { Configuracoes } from "./configuracoes";
import { Qualidade } from "./qualidade";
import { LINK_DA_PLANILHA_MODELO } from "@/lib/finance/dividas-importacao";

const ABAS = [
  { id: "painel", label: "Painel" },
  { id: "dividas", label: "Dívidas" },
  { id: "acordos", label: "Acordos" },
  { id: "credores", label: "Credores" },
  { id: "qualidade", label: "Qualidade dos dados" },
  { id: "configuracoes", label: "Configurações" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

/**
 * LEVANTAMENTO DE DÍVIDAS (0404, fase 1): o que a rede deve a terceiros, por
 * CNPJ — unidades e franqueadora. Só o Financeiro da Franqueadora (e o Admin
 * Master); o banco recusa os outros mesmo que a matriz seja mudada.
 * Acordos desde a fase 5 (0408); o Painel (cards e gráficos) na fase 6.
 */
export default async function DividasPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) redirect("/financeiro");
  const { aba: abaPedida } = await searchParams;
  // O Painel abre primeiro (plano, seção 3).
  const aba: Aba = ABAS.some((a) => a.id === abaPedida) ? (abaPedida as Aba) : "painel";

  const [base, lista, fase2, doFinanceiro, posicoes, acordos, fotos] = await Promise.all([
    carregarBase(),
    carregarDividas(),
    carregarResumoDaFase2(),
    carregarTitulosDasDividas(),
    carregarPosicoes(),
    aba === "acordos" || aba === "painel" ? carregarAcordos() : Promise.resolve({ ok: true, acordos: [] }),
    aba === "painel" ? carregarFotografias() : Promise.resolve(null),
  ]);
  const linhas = linhasDaLista(lista.dividas, base, fase2, doFinanceiro.titulos, posicoes);
  // Fase 7: a DRE dos 3 meses fechados de cada CNPJ com dívida (só no Painel).
  const hoje = todayInBrazil();
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const inicioDosFechados = (() => {
    const d = new Date(`${mesAtual}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 3);
    return d.toISOString().slice(0, 10);
  })();
  const fimDosFechados = (() => {
    const d = new Date(`${mesAtual}T12:00:00Z`);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  })();
  const dre =
    aba === "painel"
      ? await carregarDreDosDevedores([...new Set(lista.dividas.map((d) => d.clinicId))], {
          de: inicioDosFechados,
          ate: fimDosFechados,
          meses: 3,
        })
      : new Map();
  const codigos = Object.fromEntries(lista.dividas.map((d) => [d.id, d.code]));
  const prazos = prazosDosSelos(base);
  // Fase 3: as dívidas A/B cadastradas antes da 0406 (ou sem "gerar já").
  const pendentes = lista.dividas
    .filter((d) => d.origin !== "C" && !d.financeSyncedAt)
    .map((d) => ({ id: d.id, code: d.code }));

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Landmark className="size-6 text-primary" />
          Levantamento de Dívidas
        </h1>
        <p className="text-sm text-muted-foreground">
          O que a rede deve a bancos, fornecedores, tributos e outros credores — de cada unidade e da
          franqueadora — para enxergar o tamanho do problema, priorizar e negociar. Não é a
          inadimplência de pacientes (essa fica em Recebíveis).
        </p>
        {!base.semMigracao && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/financeiro/dividas/saldo-de-abertura" className="underline">
              Saldo de abertura do passivo (para o contador)
            </Link>
            {podeImportarDividas(session) && (
              <Link href="/financeiro/dividas/importar" className="inline-flex items-center gap-1 underline">
                <FileUp className="size-4" />
                Importar planilha
              </Link>
            )}
            <a href={LINK_DA_PLANILHA_MODELO} download className="inline-flex items-center gap-1 underline">
              <Download className="size-4" />
              Baixar planilha-modelo
            </a>
          </div>
        )}
      </div>

      {base.semMigracao ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Esta tela precisa de uma atualização do banco de dados (migração 0404) que ainda não foi
          aplicada aqui. Até lá, as dívidas não podem ser consultadas nem lançadas.
        </p>
      ) : (
        <>
          <nav className="flex gap-1 border-b text-sm">
            {ABAS.map((a) => (
              <Link
                key={a.id}
                href={a.id === "painel" ? "/financeiro/dividas" : `/financeiro/dividas?aba=${a.id}`}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2",
                  aba === a.id ? "border-gold font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {a.label}
              </Link>
            ))}
          </nav>

          {lista.ok && !fase2.ok && aba === "dividas" && (
            <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Restrições e propostas não puderam ser lidas (falta a migração 0405 neste banco?). Selos e
              totais de proposta aparecem vazios até lá.
            </p>
          )}

          {!lista.ok && aba !== "configuracoes" && (
            <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              Não foi possível ler as dívidas agora. Recarregue a página; se continuar, avise o suporte.
            </p>
          )}

          {aba === "dividas" && podeLancarDividas(session) && pendentes.length > 0 && <GerarPendentes pendentes={pendentes} />}
          {aba === "dividas" && (
            <ListaDeDividas base={base} linhas={linhas} hoje={todayInBrazil()} prazos={prazos} podeLancar={podeLancarDividas(session)} />
          )}
          {aba === "painel" && lista.ok && (
            <PainelDasDividas
              base={base}
              linhas={linhas}
              acordos={acordos.acordos.map((a) => ({
                clinicId: a.clinicId,
                situacao: a.situacao,
                dividas: a.dividas.map((x) => x.debtId),
                descontoCents: a.descontoCents,
                abertas: a.titulos
                  .filter((t) => t.status === "aberta" || t.status === "parcial")
                  .map((t) => ({ faltaCents: Math.max(t.valorCents - t.pagoCents, 0), vencimento: t.vencimento })),
                parcelasDoMesCents: a.titulos
                  .filter((t) => t.link === "acordo" && t.status !== "cancelada" && t.status !== "renegociada" && t.vencimento.slice(0, 7) === mesAtual.slice(0, 7))
                  .reduce((x, t) => x + t.valorCents, 0),
              }))}
              dre={[...dre.entries()]}
              periodoDaDre={{ de: inicioDosFechados, ate: fimDosFechados }}
              fotos={fotos}
              hoje={hoje}
              semRegraUnica={posicoes === null}
            />
          )}
          {aba === "acordos" && (
            <AcordosDaRede acordos={acordos.acordos} ok={acordos.ok && posicoes !== null} base={base} codigos={codigos} hoje={todayInBrazil()} />
          )}
          {aba === "credores" && <Credores base={base} linhas={linhas} podeLancar={podeLancarDividas(session)} />}
          {aba === "qualidade" && <Qualidade base={base} dividas={lista.dividas} hoje={todayInBrazil()} prazoDaConferencia={prazos.conferencia} />}
          {aba === "configuracoes" && <Configuracoes base={base} podeConfigurar={podeConfigurarDividas(session)} />}
        </>
      )}
    </div>
  );
}
