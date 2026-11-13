import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { podeConfigurarDividas, podeLancarDividas, podeVerDividas } from "@/lib/finance/dividas-acesso";
import { carregarBase, carregarDividas, carregarResumoDaFase2, linhasDaLista, prazosDosSelos } from "./dados";
import { ListaDeDividas } from "./lista-de-dividas";
import { Credores } from "./credores";
import { Configuracoes } from "./configuracoes";

const ABAS = [
  { id: "dividas", label: "Dívidas" },
  { id: "credores", label: "Credores" },
  { id: "configuracoes", label: "Configurações" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

/**
 * LEVANTAMENTO DE DÍVIDAS (0404, fase 1): o que a rede deve a terceiros, por
 * CNPJ — unidades e franqueadora. Só o Financeiro da Franqueadora (e o Admin
 * Master); o banco recusa os outros mesmo que a matriz seja mudada.
 * Painel e Acordos chegam nas fases 5 e 6.
 */
export default async function DividasPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const session = await getSessionContext();
  if (!podeVerDividas(session)) redirect("/financeiro");
  const { aba: abaPedida } = await searchParams;
  const aba: Aba = ABAS.some((a) => a.id === abaPedida) ? (abaPedida as Aba) : "dividas";

  const [base, lista, fase2] = await Promise.all([carregarBase(), carregarDividas(), carregarResumoDaFase2()]);
  const linhas = linhasDaLista(lista.dividas, base, fase2);
  const prazos = prazosDosSelos(base);

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
                href={a.id === "dividas" ? "/financeiro/dividas" : `/financeiro/dividas?aba=${a.id}`}
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

          {aba === "dividas" && (
            <ListaDeDividas base={base} linhas={linhas} hoje={todayInBrazil()} prazos={prazos} podeLancar={podeLancarDividas(session)} />
          )}
          {aba === "credores" && <Credores base={base} linhas={linhas} podeLancar={podeLancarDividas(session)} />}
          {aba === "configuracoes" && <Configuracoes base={base} podeConfigurar={podeConfigurarDividas(session)} />}
        </>
      )}
    </div>
  );
}
