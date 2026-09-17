import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, UserPlus } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONTRACT_LABELS,
  CONTRACT_TYPES,
  type ContractType,
} from "@/lib/staff";
import {
  FILTROS_DE_ACESSO,
  SITUACOES_DE_CADASTRO,
  contarEquipe,
  lerFiltros,
  ordenar,
  passaNoFiltro,
  situacaoDeAcesso,
  type PessoaDaEquipe,
} from "@/lib/risartanos";
import { alcanceDoUsuario, carregarEquipe, podeVerEquipe } from "./dados";
import { SeloDeAcesso, SeloDeUnidade } from "./selos";

export const metadata: Metadata = { title: "Risartanos" };

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * RISARTANOS — a equipe num lugar só.
 *
 * Antes eram duas telas: o cadastro de RH aqui e o login em "Usuários
 * (acesso)". A mesma pessoa vivia partida ao meio, e a pergunta que mais
 * importa — *quem ainda entra no sistema?* — exigia abrir as duas e comparar de
 * cabeça. Agora cada Risartano é UMA linha, que carrega o cadastro e o acesso.
 *
 * O que NÃO mudou: quem pode o quê. Ver a lista continua sendo Admin,
 * Franqueadora/RH, Gerente e Franqueado (matriz 0246 + RLS da 0080); mexer em
 * login, senha e função continua sendo só do Admin Master.
 */
export default async function RisartanosPage(props: PageProps<"/risartanos">) {
  const session = await getSessionContext();
  if (!podeVerEquipe(session)) redirect("/");

  const alcance = await alcanceDoUsuario(session);
  if (alcance.escopoIds !== null && alcance.escopoIds.length === 0) redirect("/");

  const supabase = await createClient();
  const { pessoas, unidades } = await carregarEquipe(supabase, session, alcance);

  const searchParams = await props.searchParams;
  const filtros = lerFiltros(searchParams, CONTRACT_TYPES);
  const contagem = contarEquipe(pessoas);
  const lista = ordenar(pessoas.filter((p) => passaNoFiltro(p, filtros)));

  // Os atalhos do topo trocam SÓ o recorte de acesso; o resto do filtro fica.
  function comAcesso(valor: string): string {
    const params = new URLSearchParams();
    if (filtros.busca) params.set("busca", filtros.busca);
    if (filtros.unidade) params.set("unidade", filtros.unidade);
    if (filtros.contrato) params.set("contrato", filtros.contrato);
    if (valor === "atencao" || valor === "acesso_desativado") {
      params.set("situacao", "todos");
    } else if (filtros.situacao !== "ativos") {
      params.set("situacao", filtros.situacao);
    }
    if (valor) params.set("acesso", valor);
    const qs = params.toString();
    return qs ? `/risartanos?${qs}` : "/risartanos";
  }

  const atalhos = [
    { valor: "", rotulo: "Toda a equipe", numero: contagem.total },
    { valor: "com_acesso", rotulo: "Com acesso", numero: contagem.comAcesso },
    { valor: "sem_acesso", rotulo: "Sem acesso", numero: contagem.semAcesso },
    { valor: "atencao", rotulo: "Precisa de atenção", numero: contagem.atencao },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Risartanos</h1>
          <p className="text-sm text-muted-foreground">
            A equipe da{" "}
            {alcance.escopoIds && alcance.escopoIds.length === 1
              ? "unidade"
              : "rede"}
            : cadastro, unidades e acesso ao sistema — tudo na mesma ficha.
          </p>
        </div>
        {alcance.podeCriar && (
          <Button
            nativeButton={false}
            render={<Link href="/risartanos/novo" />}
            className="shrink-0"
          >
            <Plus className="mr-1 size-4" />
            Novo Risartano
          </Button>
        )}
      </header>

      <nav className="flex flex-wrap gap-2">
        {atalhos.map((a) => {
          const ativo =
            filtros.acesso === a.valor ||
            (a.valor === "" && filtros.acesso === "");
          const alerta = a.valor === "atencao" && a.numero > 0;
          return (
            <Link
              key={a.valor || "todos"}
              href={comAcesso(a.valor)}
              className={[
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                ativo
                  ? "border-primary bg-primary text-primary-foreground"
                  : alerta
                    ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
                    : "border-border bg-card text-foreground hover:bg-muted",
              ].join(" ")}
            >
              {a.rotulo}
              <span
                className={[
                  "ml-1.5 tabular-nums",
                  ativo ? "opacity-90" : "text-muted-foreground",
                ].join(" ")}
              >
                {a.numero}
              </span>
            </Link>
          );
        })}
      </nav>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <Input
          name="busca"
          defaultValue={filtros.busca}
          placeholder="Buscar por nome, e-mail, CPF ou código..."
          className="h-9 w-full sm:w-72"
        />
        {unidades.length > 1 && (
          <select name="unidade" defaultValue={filtros.unidade} className={selectClass}>
            <option value="">Todas as unidades</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select name="contrato" defaultValue={filtros.contrato} className={selectClass}>
          <option value="">Todos os regimes</option>
          {CONTRACT_TYPES.map((c) => (
            <option key={c} value={c}>
              {CONTRACT_LABELS[c]}
            </option>
          ))}
        </select>
        <select name="situacao" defaultValue={filtros.situacao} className={selectClass}>
          {SITUACOES_DE_CADASTRO.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="acesso" defaultValue={filtros.acesso} className={selectClass}>
          {FILTROS_DE_ACESSO.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </FilterForm>

      <section className="overflow-hidden rounded-xl border bg-card">
        <p className="border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {lista.length === contagem.total
            ? `${lista.length} pessoa${lista.length === 1 ? "" : "s"}`
            : `${lista.length} de ${contagem.total}`}
        </p>
        {lista.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Ninguém por aqui com esse recorte. Tente “Toda a equipe”.
          </p>
        ) : (
          <ul className="divide-y">
            {lista.map((p) => (
              <Linha key={`${p.tipo}-${p.chave}`} pessoa={p} />
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Cada linha é uma pessoa: o cadastro de RH e o login do sistema vivem na
        mesma ficha. Quem cria login, redefine senha e muda função continua sendo
        o Admin Master.
      </p>
    </div>
  );
}

function Linha({ pessoa }: { pessoa: PessoaDaEquipe }) {
  const situacao = situacaoDeAcesso(pessoa);
  const iniciais = pessoa.nome.slice(0, 2).toUpperCase();

  return (
    <li>
      <Link
        href={pessoa.href}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {pessoa.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pessoa.fotoUrl}
              alt=""
              className="size-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className={[
                "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                pessoa.tipo === "login"
                  ? "bg-gold/15 text-gold-tinta"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {pessoa.tipo === "login" ? (
                <UserPlus className="size-4" />
              ) : (
                iniciais
              )}
            </span>
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{pessoa.nome}</span>
              {pessoa.code && (
                <span className="font-mono text-xs text-gold-tinta">
                  {pessoa.code}
                </span>
              )}
              {!pessoa.ativo && pessoa.tipo === "risartano" && (
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  Fora da equipe
                </span>
              )}
              {pessoa.isAdminMaster && (
                <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-medium text-gold-foreground">
                  Admin Master
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {pessoa.email ?? "sem e-mail no cadastro"}
            </span>
          </span>
        </span>

        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {pessoa.unidades.length > 0 ? (
            pessoa.unidades.map((u) => (
              <SeloDeUnidade
                key={u.clinicId}
                nome={u.clinicName}
                funcao={u.roleLabel}
                inativo={u.inativo}
                gerida={u.gerida}
              />
            ))
          ) : (
            <span className="text-xs text-muted-foreground">
              {pessoa.unidadeOrigem ?? "sem unidade"}
              {pessoa.tipo === "risartano" && " · sem função definida"}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {pessoa.regime && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {CONTRACT_LABELS[pessoa.regime as ContractType]}
            </span>
          )}
          <SeloDeAcesso situacao={situacao} />
        </span>
      </Link>
    </li>
  );
}
