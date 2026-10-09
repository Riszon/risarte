import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  VISAO_EXPLICA,
  VISAO_ROTULO,
  VISOES,
  enderecoDaVisao,
  lerVisao,
  texto,
  type Pessoas,
} from "./comum";
import { VisaoAcessos } from "./visao-acessos";
import { VisaoAcoes } from "./visao-acoes";
import { VisaoAlteracoes } from "./visao-alteracoes";
import { VisaoPessoa } from "./visao-pessoa";
import { VisaoRelatorio } from "./visao-relatorio";

export const metadata: Metadata = { title: "Auditoria" };

// A AUDITORIA, em cinco visões (0287 + 0288 + 0289):
//   * Alterações — o que mudou, campo a campo (o banco registra sozinho);
//   * Ações — o que cada pessoa fez nas telas (consultou, exportou, entrou);
//   * Acessos — um registro por login, com tempo em uso e parado;
//   * O dia de uma pessoa — tudo isso junto, em ordem, para UMA pessoa;
//   * Relatório de atividade — os números por pessoa e por dia, com planilha.
// Só o Admin Master entra — e é o banco que garante (RLS), não esta tela.
export default async function AuditoriaPage(
  props: PageProps<"/admin/auditoria">
) {
  await requireAdminMaster();
  const supabase = await createClient();
  const searchParams = await props.searchParams;
  const visao = lerVisao(searchParams.visao);

  // As pessoas e as unidades, uma vez só: servem ao filtro e para trocar
  // identificador por nome em todas as visões.
  const [{ data: perfis }, { data: risartanos }, { data: unidades }] =
    await Promise.all([
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("staff_members").select("user_id, code").not("user_id", "is", null),
      supabase.from("clinics").select("id, name"),
    ]);

  const pessoas: Pessoas = {
    nomes: { usuarios: new Map(), unidades: new Map() },
    codigoPorUsuario: new Map(),
    opcoes: [],
  };
  for (const s of risartanos ?? []) {
    if (s.user_id && s.code) pessoas.codigoPorUsuario.set(s.user_id, s.code);
  }
  for (const p of perfis ?? []) {
    const nome = p.full_name || p.email || "—";
    pessoas.nomes.usuarios.set(p.id, nome);
    const codigo = pessoas.codigoPorUsuario.get(p.id);
    pessoas.opcoes.push({ value: p.id, label: codigo ? `${nome} (${codigo})` : nome });
  }
  for (const c of unidades ?? []) pessoas.nomes.unidades.set(c.id, c.name);

  // Trocar de aba mantém a pessoa escolhida (é a pergunta mais comum:
  // "e o que mais ela fez?").
  const colaborador = texto(searchParams.colaborador);
  const manter = {
    colaborador: pessoas.nomes.usuarios.has(colaborador) ? colaborador : undefined,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">{VISAO_EXPLICA[visao]}</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Visões da auditoria">
        {VISOES.map((v) => (
          <Link
            key={v}
            href={enderecoDaVisao(v, manter)}
            aria-current={v === visao ? "page" : undefined}
            className={
              v === visao
                ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {VISAO_ROTULO[v]}
          </Link>
        ))}
      </nav>

      {visao === "alteracoes" && (
        <VisaoAlteracoes supabase={supabase} pessoas={pessoas} searchParams={searchParams} />
      )}
      {visao === "acoes" && (
        <VisaoAcoes supabase={supabase} pessoas={pessoas} searchParams={searchParams} />
      )}
      {visao === "acessos" && (
        <VisaoAcessos supabase={supabase} pessoas={pessoas} searchParams={searchParams} />
      )}
      {visao === "pessoa" && (
        <VisaoPessoa supabase={supabase} pessoas={pessoas} searchParams={searchParams} />
      )}
      {visao === "relatorio" && (
        <VisaoRelatorio pessoas={pessoas} searchParams={searchParams} />
      )}
    </div>
  );
}
