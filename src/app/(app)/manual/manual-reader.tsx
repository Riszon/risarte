"use client";

import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizar, type Bloco, type Secao, type Trecho } from "@/lib/markdown";

/**
 * O leitor do manual.
 *
 * A busca é por SEÇÃO, não por trecho solto: quem procura "anamnese" quer
 * chegar ao roteiro do Coordenador inteiro, não a uma frase sem o passo
 * anterior nem o seguinte. Manual é texto que se lê em contexto — devolver a
 * linha isolada seria devolver a resposta sem a pergunta.
 */

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return (
    <>
      {trechos.map((t, i) => {
        switch (t.t) {
          case "texto":
            return <span key={i}>{t.v}</span>;
          case "negrito":
            return (
              <strong key={i} className="font-semibold text-foreground">
                <Trechos trechos={t.filhos} />
              </strong>
            );
          case "italico":
            return (
              <em key={i}>
                <Trechos trechos={t.filhos} />
              </em>
            );
          case "codigo":
            return (
              <code
                key={i}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-primary"
              >
                {t.v}
              </code>
            );
          case "link":
            // Os links do manual apontam para os documentos de apoio, que não
            // estão publicados. Mostrar o rótulo sem link é honesto; um link
            // que dá 404 faz a pessoa achar que o sistema quebrou.
            return (
              <span key={i} className="underline decoration-dotted underline-offset-2">
                <Trechos trechos={t.filhos} />
              </span>
            );
        }
      })}
    </>
  );
}

function Blocos({ blocos }: { blocos: Bloco[] }) {
  return (
    <>
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case "titulo": {
            const Tag = (b.nivel <= 3 ? "h3" : "h4") as "h3" | "h4";
            return (
              <Tag
                key={i}
                id={b.id}
                className={cn(
                  "scroll-mt-6 font-semibold text-foreground",
                  b.nivel <= 3 ? "mt-8 text-lg" : "mt-6 text-base text-gold"
                )}
              >
                <Trechos trechos={b.texto} />
              </Tag>
            );
          }

          case "paragrafo":
            return (
              <p key={i} className="mt-3 leading-relaxed text-muted-foreground">
                <Trechos trechos={b.texto} />
              </p>
            );

          case "lista": {
            const Tag = b.ordenada ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={cn(
                  "mt-3 space-y-1.5 pl-5 text-muted-foreground",
                  b.ordenada ? "list-decimal" : "list-disc"
                )}
              >
                {b.itens.map((item, j) => (
                  <li key={j} className="leading-relaxed">
                    <Trechos trechos={item} />
                  </li>
                ))}
              </Tag>
            );
          }

          case "checklist":
            return (
              <ul key={i} className="mt-3 space-y-1.5 text-muted-foreground">
                {b.itens.map((item, j) => (
                  <li key={j} className="flex gap-2 leading-relaxed">
                    <span aria-hidden className="text-gold">
                      ☐
                    </span>
                    <span>
                      <Trechos trechos={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );

          case "tabela":
            return (
              // Tabela larga rola dentro da própria caixa: sem isto a página
              // inteira ganha barra horizontal e o texto sai da tela.
              <div key={i} className="mt-4 overflow-x-auto rounded-lg border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-primary text-primary-foreground">
                      {b.cabecalho.map((c, j) => (
                        <th key={j} className="px-3 py-2 text-left font-medium">
                          <Trechos trechos={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.linhas.map((linha, j) => (
                      <tr key={j} className={cn(j % 2 === 1 && "bg-muted/40")}>
                        {linha.map((c, k) => (
                          <td
                            key={k}
                            className="border-t px-3 py-2 align-top text-muted-foreground"
                          >
                            <Trechos trechos={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "codigo":
            return (
              <pre
                key={i}
                className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed"
              >
                {b.linhas.join("\n")}
              </pre>
            );

          case "aviso":
            return (
              <div
                key={i}
                className="mt-4 rounded-r-lg border-l-4 border-gold bg-muted/50 px-4 py-3 text-sm"
              >
                <Blocos blocos={b.blocos} />
              </div>
            );

          case "regua":
            return null;
        }
      })}
    </>
  );
}

export function ManualReader({
  secoes,
  versao,
  migracao,
}: {
  secoes: Secao[];
  versao: string;
  migracao: string;
}) {
  const [busca, setBusca] = useState("");
  const [ativa, setAtiva] = useState(secoes[0]?.id ?? "");

  const termo = normalizar(busca.trim());
  const encontradas = useMemo(
    () => (termo.length < 2 ? secoes : secoes.filter((s) => s.busca.includes(termo))),
    [secoes, termo]
  );

  // Buscando, mostra TODAS as seções que casam, uma embaixo da outra: a pessoa
  // que procura "desconto" não sabe em qual seção está a resposta, e obrigá-la
  // a abrir uma por uma seria devolver o trabalho da busca para ela.
  const buscando = termo.length >= 2;
  const visiveis = buscando
    ? encontradas
    : encontradas.filter((s) => s.id === ativa).slice(0, 1);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <BookOpen className="size-6 text-gold" />
          Manual de Treinamento
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta é a versão do sistema que você está usando agora —{" "}
          <strong className="font-medium text-foreground">
            versão {versao} · migração {migracao}
          </strong>
          . Ele muda junto com o sistema, então não existe manual velho aqui.
        </p>
      </header>

      <div className="mb-5 relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar no manual (ex.: anamnese, desconto, permissão)"
          className="pl-9"
          aria-label="Procurar no manual"
        />
      </div>

      {buscando && (
        <p className="mb-4 text-sm text-muted-foreground">
          {encontradas.length === 0
            ? `Nenhuma seção fala de “${busca.trim()}”.`
            : `${encontradas.length} ${
                encontradas.length === 1 ? "seção fala" : "seções falam"
              } de “${busca.trim()}”.`}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <nav className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Seções
          </p>
          <ul className="space-y-0.5">
            {secoes.map((s) => {
              const casa = !buscando || encontradas.some((e) => e.id === s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setBusca("");
                      setAtiva(s.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className={cn(
                      "w-full rounded-md px-2.5 py-1.5 text-left text-sm",
                      !buscando && s.id === ativa
                        ? "bg-primary font-medium text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                      buscando && !casa && "opacity-40"
                    )}
                  >
                    {s.titulo}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <article className="min-w-0 text-sm">
          {visiveis.map((s) => (
            <section key={s.id} className="mb-10">
              <h2 className="border-b-2 border-gold pb-2 text-xl font-semibold">
                {s.titulo}
              </h2>
              <Blocos blocos={s.blocos} />
            </section>
          ))}
          {visiveis.length === 0 && (
            <p className="text-muted-foreground">
              Escolha uma seção ao lado, ou limpe a busca.
            </p>
          )}
        </article>
      </div>
    </div>
  );
}
