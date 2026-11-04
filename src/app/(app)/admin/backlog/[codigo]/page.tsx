import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { carregarEnderecos } from "@/lib/ambientes-db";
import { formatInBrazil, formatIsoDateInBrazil } from "@/lib/dates";
import { parseMarkdown } from "@/lib/markdown";
import { MODULO_ROTULO, type ModuloDoSistema } from "@/lib/system-reports";
import { EVENTO_ROTULO, estaFechado, valorDoEvento } from "@/lib/backlog";
import { Blocos } from "../../../manual/manual-reader";
import { carregarCategorias, carregarDetalhe } from "../dados";
import { SeloDePrioridade, SeloDeSituacao } from "../pecas";
import { EditarItem } from "./editar";

type Props = { params: Promise<{ codigo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { codigo } = await params;
  return { title: `${codigo.toUpperCase()} · Backlog` };
}

const ORIGEM: Record<string, string> = {
  backlog_md: "importado do arquivo antigo",
  relato: "veio de um relato",
  sessao: "registrado por uma sessão",
  dono: "registrado por você",
};

function quando(iso: string): string {
  return formatInBrazil(iso, { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function ItemDoBacklogPage({ params }: Props) {
  await requireAdminMaster();
  const { codigo } = await params;
  const code = codigo.toUpperCase();
  if (!/^AP\d+$/.test(code)) notFound();

  const supabase = await createClient();
  const [lido, categorias, enderecos] = await Promise.all([
    carregarDetalhe(code),
    carregarCategorias(),
    carregarEnderecos(supabase),
  ]);
  // O relato do treino abre na tela de lá: o mesmo código pode existir nos dois bancos.
  const enderecoDoTreino = enderecos.treino?.replace(/\/$/, "") ?? null;
  if (lido.ok && lido.dados === null) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <Link href="/admin/backlog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" />
        Backlog
      </Link>

      {!lido.ok || !categorias.ok ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          Não foi possível ler este item agora. Recarregue a página; se continuar, avise.
        </p>
      ) : (
        (() => {
          const { item, eventos, relatos } = lido.dados!;
          const blocos = parseMarkdown(item.detail || "_Sem detalhe escrito._");
          return (
            <>
              <header className="space-y-2">
                <p className="font-mono text-sm text-muted-foreground">{item.code}</p>
                <h1 className="text-xl font-semibold tracking-tight">{item.title}</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <SeloDeSituacao situacao={item.status} />
                  {!estaFechado(item.status) && <SeloDePrioridade prioridade={item.priority} />}
                  <span>{item.category}</span>
                  {item.module && <span>· {MODULO_ROTULO[item.module as ModuloDoSistema] ?? item.module}</span>}
                  <span>
                    · achado em {formatIsoDateInBrazil(item.foundOn, { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </span>
                  <span>· {ORIGEM[item.origin] ?? item.origin}</span>
                </div>
                {estaFechado(item.status) && (
                  <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
                    <strong>{item.status === "resolvido" ? "Resolvido" : "Descartado"}</strong>
                    {item.resolvedAt
                      ? ` em ${formatInBrazil(item.resolvedAt, { day: "2-digit", month: "2-digit", year: "numeric" })}`
                      : ""}
                    {item.resolvedVersion ? ` · ${item.resolvedVersion}` : ""}
                    {item.resolution ? ` — ${item.resolution}` : ""}
                  </p>
                )}
              </header>

              <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <article className="min-w-0 space-y-3 rounded-lg border p-4 text-sm leading-relaxed [overflow-wrap:anywhere]">
                  <Blocos blocos={blocos} />
                </article>

                <aside className="space-y-5">
                  <EditarItem item={item} categorias={categorias.dados} />

                  {relatos.length > 0 && (
                    <section className="space-y-2">
                      <h2 className="text-sm font-semibold">Relatos ligados</h2>
                      {/* B-D4: resolvido o item, quem relatou espera a resposta — o dono decide o texto. */}
                      {estaFechado(item.status) && (
                        <p className="rounded-md border border-violet-300 bg-violet-50 p-2 text-xs dark:bg-violet-950/30">
                          O item foi {item.status === "resolvido" ? "resolvido" : "descartado"}: responda{" "}
                          {relatos.length === 1 ? "o relato" : "os relatos"} abaixo — quem relatou está esperando.
                        </p>
                      )}
                      <ul className="space-y-1 text-sm">
                        {relatos.map((r) => (
                          <li key={`${r.ambiente}-${r.code}`}>
                            <Link
                              href={
                                r.ambiente === "treino" && enderecoDoTreino
                                  ? `${enderecoDoTreino}/problemas/${r.code}`
                                  : `/problemas/${r.code}`
                              }
                              className="hover:underline"
                            >
                              <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                              {r.ambiente === "treino" && <span className="ml-1 text-xs text-amber-700">(treino)</span>}{" "}
                              {r.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="space-y-2">
                    <h2 className="text-sm font-semibold">Linha do tempo</h2>
                    <ol className="space-y-2 border-l pl-3 text-sm">
                      {eventos.map((e) => {
                        const de = valorDoEvento(e.kind, e.fromValue);
                        const para = valorDoEvento(e.kind, e.toValue);
                        return (
                          <li key={e.id}>
                            <p>
                              <span className="font-medium">{EVENTO_ROTULO[e.kind] ?? e.kind}</span>
                              {e.kind !== "criado" && (de || para) && (
                                <span className="text-muted-foreground">
                                  {de ? `: ${de} → ` : ": "}
                                  {para ?? "—"}
                                </span>
                              )}
                            </p>
                            {e.note && <p className="whitespace-pre-wrap text-muted-foreground">{e.note}</p>}
                            <p className="text-xs text-muted-foreground">
                              {quando(e.createdAt)} · {e.author}
                            </p>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                </aside>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
