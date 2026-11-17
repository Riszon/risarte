import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { periodoDoMes } from "@/lib/finance/network-areas";
import { carregarPainelDeCoberturas } from "@/lib/coberturas-painel-db";
import { EquipeECoberturas } from "@/components/equipe-e-coberturas";
import { podeVerEquipe } from "../dados";

export const metadata: Metadata = { title: "Equipe e coberturas" };

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Funções de apoio, F4 — o painel "Equipe e coberturas" para quem cuida da
 * equipe (D12): o Admin e a Franqueadora veem a rede; o Gerente e o
 * Franqueado, a própria unidade. Quem vê o quê é o banco (0419). O mesmo
 * painel aparece no Painel da rede, aba "Equipe e coberturas". Os avisos da
 * rotina diária trazem para cá.
 */
export default async function CoberturasPage(props: PageProps<"/risartanos/coberturas">) {
  const session = await getSessionContext();
  if (!podeVerEquipe(session)) redirect("/");

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const hoje = todayInBrazil();
  const periodo = periodoDoMes(
    Number(pick("ano") ?? hoje.slice(0, 4)),
    Number(pick("mes") ?? hoje.slice(5, 7)),
    hoje
  );
  const anterior = periodo.mes === 1 ? { ano: periodo.ano - 1, mes: 12 } : { ano: periodo.ano, mes: periodo.mes - 1 };
  const seguinte = periodo.mes === 12 ? { ano: periodo.ano + 1, mes: 1 } : { ano: periodo.ano, mes: periodo.mes + 1 };
  const noFuturo = `${seguinte.ano}-${String(seguinte.mes).padStart(2, "0")}` > hoje.slice(0, 7);
  const href = (p: { ano: number; mes: number }) => `/risartanos/coberturas?ano=${p.ano}&mes=${p.mes}`;

  const supabase = await createClient();
  const dados = await carregarPainelDeCoberturas(supabase, periodo.de, periodo.ate);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <header className="space-y-1">
        <Link href="/risartanos" className="text-xs text-muted-foreground hover:underline">
          ← Risartanos
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Users className="size-6 text-primary" />
          Equipe e coberturas
        </h1>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <Link href={href(anterior)} className="rounded-md border p-1.5 hover:bg-muted" aria-label="Mês anterior">
          <ChevronLeft className="size-4" />
        </Link>
        <span className="min-w-36 text-center font-medium">
          {MESES[periodo.mes - 1]} de {periodo.ano}
        </span>
        {noFuturo ? (
          <span className="rounded-md border p-1.5 opacity-40" aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        ) : (
          <Link href={href(seguinte)} className="rounded-md border p-1.5 hover:bg-muted" aria-label="Mês seguinte">
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>

      {dados.ok ? (
        <EquipeECoberturas
          unidades={dados.unidades}
          pessoas={dados.pessoas}
          linkDaPessoa={session.isAdminMaster ? (id) => `/risartanos/acesso/${id}` : undefined}
        />
      ) : (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {dados.erro}
        </p>
      )}
    </div>
  );
}
