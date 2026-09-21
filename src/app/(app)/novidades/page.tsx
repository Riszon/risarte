import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { FilterForm } from "@/components/filter-form";
import { Input } from "@/components/ui/input";
import { Novidades } from "@/components/novidades";
import {
  TIPO_ROTULO,
  anosDasNovidades,
  filtrarNovidades,
  novidadesPara,
  paginarNovidades,
  type TipoDeMudanca,
} from "@/lib/changelog";

export const metadata: Metadata = { title: "Novidades do sistema" };

/**
 * TODAS AS NOVIDADES — com busca, filtros e páginas.
 *
 * Pedido do dono (19/09/2026): *"na tela de início está ficando uma lista muito
 * extensa"*. Estava: as 57 entregas apareciam inteiras lá. O Início ficou com
 * as ÚLTIMAS e esta tela recebeu o resto — que é o lugar de quem PROCURA uma
 * mudança ("quando foi que a agenda mudou?"), e não de quem só abriu o sistema
 * para trabalhar.
 *
 * Continua filtrada por papel (`novidadesPara`): a correção da recepção não diz
 * nada ao dentista. O Admin Master vê tudo.
 *
 * Os filtros aplicam-se sozinhos (`FilterForm`, padrão do sistema desde o
 * LOTE F1) e viajam no endereço — dá para mandar o link de uma busca a alguém.
 */
export default async function NovidadesPage(
  props: PageProps<"/novidades">
) {
  const session = await getSessionContext();
  const params = await props.searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const papeis = [...new Set(Object.values(session.rolesByClinic).flat())];
  const minhas = novidadesPara(papeis, session.isAdminMaster);

  const busca = um(params.busca);
  const tipo = um(params.tipo) as TipoDeMudanca | "";
  const ano = um(params.ano);
  const filtradas = filtrarNovidades(minhas, { busca, tipo, ano });
  const pagina = paginarNovidades(filtradas, Number(um(params.pagina) || "1"));

  // O endereço de outra página, mantendo os filtros.
  function href(p: number): string {
    const q = new URLSearchParams();
    if (busca) q.set("busca", busca);
    if (tipo) q.set("tipo", tipo);
    if (ano) q.set("ano", ano);
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return s ? `/novidades?${s}` : "/novidades";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Início
      </Link>

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="size-6 text-gold-tinta" />
          Novidades do sistema
        </h1>
        <p className="text-sm text-muted-foreground">
          Tudo o que mudou, da entrega mais recente para a mais antiga.
          {session.isAdminMaster
            ? " Você vê todas as entregas."
            : " Aparece o que alcança a sua função."}
        </p>
      </header>

      <FilterForm className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input
          name="busca"
          defaultValue={busca}
          placeholder="Procurar por palavra (ex.: agenda, senha, estoque)"
          aria-label="Procurar nas novidades"
        />
        <select
          name="tipo"
          defaultValue={tipo}
          aria-label="Tipo"
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Todos os tipos</option>
          {(Object.keys(TIPO_ROTULO) as TipoDeMudanca[]).map((t) => (
            <option key={t} value={t}>
              {TIPO_ROTULO[t]}
            </option>
          ))}
        </select>
        <select
          name="ano"
          defaultValue={ano}
          aria-label="Ano"
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Todos os anos</option>
          {anosDasNovidades(minhas).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </FilterForm>

      <p className="text-xs text-muted-foreground">
        {pagina.total === 0
          ? "Nenhuma entrega encontrada com esses filtros."
          : `${pagina.total} entrega${pagina.total > 1 ? "s" : ""} · página ${pagina.pagina} de ${pagina.totalDePaginas}`}
      </p>

      <Novidades versoes={pagina.versoes} />

      {pagina.totalDePaginas > 1 && (
        <nav className="flex items-center justify-between gap-2 border-t pt-4 text-sm">
          {pagina.pagina > 1 ? (
            <Link
              href={href(pagina.pagina - 1)}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <ArrowLeft className="size-4" />
              Mais recentes
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            {pagina.pagina} / {pagina.totalDePaginas}
          </span>
          {pagina.pagina < pagina.totalDePaginas ? (
            <Link
              href={href(pagina.pagina + 1)}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Mais antigas
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
