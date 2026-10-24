import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Target } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Button } from "@/components/ui/button";
import { CartaoDaMeta } from "@/components/metas/cartao-da-meta";
import { canViewMetas, podeCriarMeta } from "@/lib/metas/access";
import { GRUPOS_DE_INDICADOR, INDICADORES_DE_META } from "@/lib/metas/indicadores";
import { ABAS, abaDa, lerAba, ondeDaMeta, situacaoEfetiva } from "@/lib/metas/regras";
import { resumirMeta } from "@/lib/metas/resumo";
import { lerAlvos, lerMetas, lerPausas, medirMetas, minhasMetas, nomesDasUnidades } from "@/lib/metas/dados";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Metas" };

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Quantas metas da aba são medidas ao abrir (cada uma é uma consulta). */
const MEDIR_NO_MAXIMO = 60;

export default async function MetasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (!canViewMetas(session)) redirect("/");
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const aba = lerAba(pick("aba"));
  const unidade = pick("unidade") ?? "";
  const indicador = pick("indicador") ?? "";
  const soMinhas = pick("minhas") === "1";

  const db = await createClient();
  const hoje = todayInBrazil();
  const [{ metas, erro }, nomes, minhas] = await Promise.all([lerMetas(db), nomesDasUnidades(db), minhasMetas(db)]);

  const filtradas = metas.filter(
    (m) =>
      (!unidade || m.scope === "network" || m.clinic_ids.includes(unidade)) &&
      (!indicador || m.indicator === indicador) &&
      (!soMinhas || minhas.has(m.id))
  );
  const contagem = new Map<string, number>();
  for (const m of filtradas) {
    const a = abaDa(situacaoEfetiva(m, hoje));
    contagem.set(a, (contagem.get(a) ?? 0) + 1);
  }
  const naAba = filtradas.filter((m) => abaDa(situacaoEfetiva(m, hoje)) === aba);
  const medir = aba === "ativas" || aba === "pausadas" || aba === "finalizadas";
  const metasAMedir = medir ? naAba.slice(0, MEDIR_NO_MAXIMO) : [];
  const aMedir = metasAMedir.map((m) => m.id);
  const [medicoes, pausas, alvos] = await Promise.all([
    medirMetas(db, metasAMedir),
    lerPausas(db, aMedir),
    lerAlvos(db, aMedir),
  ]);

  const unidadesDasMetas = [...new Set(metas.flatMap((m) => m.clinic_ids))]
    .map((id) => ({ id, nome: nomes.get(id) ?? "Unidade" }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const abas = ABAS.filter((a) => a.chave !== "rascunhos" || (contagem.get("rascunhos") ?? 0) > 0);
  const qs = (novaAba: string) => {
    const p = new URLSearchParams();
    p.set("aba", novaAba);
    if (unidade) p.set("unidade", unidade);
    if (indicador) p.set("indicador", indicador);
    if (soMinhas) p.set("minhas", "1");
    return `/metas?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Gestão"
        icone={Target}
        titulo="Metas"
        descricao="Metas SMART da rede e das unidades: específicas, mensuráveis, atingíveis, relevantes e com prazo. A barra mostra o realizado, medido direto do sistema."
      >
        {podeCriarMeta(session) && (
          <Button
            nativeButton={false}
            render={<Link href="/metas/nova" />}
            className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
          >
            <Plus className="mr-1 size-4" /> Nova meta
          </Button>
        )}
      </CabecalhoDeModulo>

      <nav className="flex flex-wrap gap-x-1 border-b" aria-label="Situação das metas">
        {abas.map((a) => (
          <Link
            key={a.chave}
            href={qs(a.chave)}
            aria-current={a.chave === aba ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              a.chave === aba
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {a.rotulo}
            <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
              {contagem.get(a.chave) ?? 0}
            </span>
          </Link>
        ))}
      </nav>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="aba" value={aba} />
        <select name="unidade" defaultValue={unidade} className={selectClass} aria-label="Unidade">
          <option value="">Todas as unidades</option>
          {unidadesDasMetas.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <select name="indicador" defaultValue={indicador} className={selectClass} aria-label="Indicador">
          <option value="">Todos os indicadores</option>
          {GRUPOS_DE_INDICADOR.map((g) => (
            <optgroup key={g} label={g}>
              {INDICADORES_DE_META.filter((i) => i.grupo === g).map((i) => (
                <option key={i.chave} value={i.chave}>
                  {i.rotulo}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="minhas" value="1" defaultChecked={soMinhas} className="size-4" />
          Só as metas em que participo
        </label>
      </FilterForm>

      {erro ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
      ) : naAba.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
          <p>Nenhuma meta nesta aba.</p>
          {aba === "ativas" && podeCriarMeta(session) && (
            <p className="mt-1">
              Crie a primeira em{" "}
              <Link href="/metas/nova" className="text-primary underline-offset-2 hover:underline">
                Nova meta
              </Link>
              .
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {naAba.map((m) => {
              const lida = medicoes.get(m.id);
              const resumo = resumirMeta(m, lida?.medicao ?? null, pausas.get(m.id) ?? [], hoje, alvos.get(m.id) ?? [], lida?.erro ?? null);
              return <CartaoDaMeta key={m.id} meta={m} resumo={resumo} onde={ondeDaMeta(m, nomes)} />;
            })}
          </div>
          {medir && naAba.length > MEDIR_NO_MAXIMO && (
            <p className="text-xs text-muted-foreground">
              Mostrando a medição das {MEDIR_NO_MAXIMO} metas mais recentes desta aba. Use os filtros para ver as outras.
            </p>
          )}
        </>
      )}

      <details className="rounded-xl border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">Como ler a barra</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong>Aumentar</strong>: o realizado dividido pelo alvo. <strong>Reduzir</strong> (ex.: faltas de 8% para 5%): quanto já
            caiu dividido por quanto precisava cair.
          </li>
          <li>
            A cor é o <strong>ritmo</strong>: verde está no ritmo; âmbar, um pouco atrás; vermelho, atrás. O traço fino marca onde a
            equipe deveria estar hoje. O traço dourado marca a meta, quando existe Super Meta.
          </li>
          <li>Meta individual: a barra é a média dos participantes (cada um conta até 100%).</li>
          <li>Ao terminar o prazo, o resultado é congelado na madrugada seguinte e não muda mais.</li>
        </ul>
      </details>
    </div>
  );
}
