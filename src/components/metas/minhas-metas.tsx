import Link from "next/link";
import { Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { lerAlvos, lerPausas, medirMetas, minhasMetas, nomesDasUnidades } from "@/lib/metas/dados";
import { CAMPOS_DA_META, ondeDaMeta, type Meta } from "@/lib/metas/regras";
import { percentuaisDasPessoas, resumirMeta } from "@/lib/metas/resumo";
import { CartaoDaMeta } from "./cartao-da-meta";

/** No máximo isto no Início — o resto fica no módulo. */
const NO_INICIO = 4;

/**
 * "MINHAS METAS" NO INÍCIO. É aqui que a meta estimula: numa tela que a
 * pessoa abre todo dia, não num painel que só o gestor visita (plano, §5).
 * Mostra as metas em que a pessoa PARTICIPA — e, na individual, a barra dela.
 *
 * Falhar aqui não pode derrubar o Início: qualquer erro de leitura some com o
 * cartão em vez de mostrar uma barra errada.
 */
export async function MinhasMetasNoInicio({ userId }: { userId: string }) {
  const db = await createClient();
  const ids = [...(await minhasMetas(db))];
  if (ids.length === 0) return null;
  const { data, error } = await db
    .from("goals")
    .select(CAMPOS_DA_META)
    .in("id", ids)
    .order("ends_on")
    .limit(NO_INICIO)
    .returns<Meta[]>();
  if (error || !data?.length) return null;
  const metas = data.map((m) => ({
    ...m,
    target_value: m.target_value == null ? null : Number(m.target_value),
    individual_value: m.individual_value == null ? null : Number(m.individual_value),
    stretch_value: m.stretch_value == null ? null : Number(m.stretch_value),
    baseline_value: m.baseline_value == null ? null : Number(m.baseline_value),
  }));
  const hoje = todayInBrazil();
  const visiveis = metas.map((m) => m.id);
  const [medicoes, pausas, alvos, nomes] = await Promise.all([
    medirMetas(db, visiveis),
    lerPausas(db, visiveis),
    lerAlvos(db, visiveis),
    nomesDasUnidades(db),
  ]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-semibold">
          <Target className="size-4 text-primary" aria-hidden /> Minhas metas
        </h2>
        <Link href="/metas?minhas=1" className="text-sm text-primary underline-offset-2 hover:underline">
          {ids.length > NO_INICIO ? `Ver todas (${ids.length})` : "Abrir Metas"}
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {metas.map((m) => {
          const lida = medicoes.get(m.id);
          const meusAlvos = alvos.get(m.id) ?? [];
          const resumo = resumirMeta(m, lida?.medicao ?? null, pausas.get(m.id) ?? [], hoje, meusAlvos, lida?.erro ?? null);
          const minha =
            m.target_mode !== "collective" && resumo.foto
              ? percentuaisDasPessoas(m, resumo.foto, meusAlvos, [userId])[0] ?? null
              : null;
          return (
            <CartaoDaMeta
              key={m.id}
              meta={m}
              resumo={resumo}
              onde={ondeDaMeta(m, nomes)}
              compacto
              minha={minha ? { pct: minha.pct, valor: minha.valor, alvo: minha.alvo } : null}
            />
          );
        })}
      </div>
    </section>
  );
}
