import "server-only";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDaysIso, todayInBrazil } from "@/lib/dates";
import { canViewMetas, podeCriarMeta } from "@/lib/metas/access";
import { nomesDasUnidades } from "@/lib/metas/dados";
import { CAMPOS_DA_META, primeiroDoMes, type Meta } from "@/lib/metas/regras";
import { montarResultados, type LinhaDoResultado } from "@/lib/metas/resultados";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * M5: a carga do relatório de resultados — UMA para a tela e a planilha (o que
 * a planilha traz é o que a tela mostrava, com o mesmo filtro).
 *
 * As metas vêm pela RLS (`can_view_goal` — R2); os percentuais por unidade e
 * por pessoa, pela leitura `goal_results_report` (0322), que só devolve pessoas
 * de metas que quem pede pode editar, mais o próprio resultado (R4).
 */
export async function carregarResultados(params: Record<string, string | undefined>) {
  const session = await getSessionContext();
  if (!canViewMetas(session)) redirect("/");
  const hoje = todayInBrazil();
  // Padrão: os últimos três meses (o mês atual e os dois anteriores).
  let de = params.de && ISO.test(params.de) ? params.de : primeiroDoMes(addDaysIso(primeiroDoMes(addDaysIso(primeiroDoMes(hoje), -1)), -1));
  let ate = params.ate && ISO.test(params.ate) ? params.ate : hoje;
  if (de > ate) [de, ate] = [ate, de];
  const unidade = params.unidade && UUID.test(params.unidade) ? params.unidade : "";

  const db = await createClient();
  const [metasLidas, leitura, nomes] = await Promise.all([
    db
      .from("goals")
      .select(CAMPOS_DA_META)
      .eq("status", "finished")
      .gte("ends_on", de)
      .lte("ends_on", ate)
      .order("ends_on", { ascending: false })
      .limit(1000)
      .returns<Meta[]>(),
    db.rpc("goal_results_report", { p_from: de, p_to: ate }),
    nomesDasUnidades(db),
  ]);

  let erro: string | null = null;
  if (metasLidas.error) {
    erro =
      metasLidas.error.code === "PGRST205" || metasLidas.error.code === "42P01"
        ? "O módulo de Metas ainda não foi instalado neste ambiente (falta a migração 0318)."
        : "Não foi possível ler as metas agora. Tente de novo em instantes.";
  }
  // Sem a 0322, o resumo, os indicadores e os objetivos saem (vêm das metas);
  // unidades e pessoas dependem da leitura nova — a tela diz isso.
  const avisoDaLeitura = leitura.error
    ? leitura.error.code === "PGRST202" || leitura.error.code === "42883"
      ? "O quadro por unidade e por pessoa ainda não existe neste banco (falta a migração 0322)."
      : "Não foi possível ler os percentuais por unidade e por pessoa agora."
    : null;

  const todas = (metasLidas.data ?? []).map((m) => ({ ...m, target_value: m.target_value == null ? null : Number(m.target_value) }));
  const metas = unidade ? todas.filter((m) => m.scope === "network" || m.clinic_ids.includes(unidade)) : todas;
  const linhas = ((leitura.data ?? []) as LinhaDoResultado[])
    .map((l) => ({ ...l, pct: l.pct == null ? null : Number(l.pct) }))
    .filter((l) => !unidade || l.subject_kind !== "clinic" || l.subject_id === unidade);

  const idsDePessoas = [...new Set(linhas.filter((l) => l.subject_kind === "user").map((l) => l.subject_id))];
  const pessoas = idsDePessoas.length
    ? await db.from("profiles").select("id, full_name").in("id", idsDePessoas.slice(0, 1000))
    : { data: [] as { id: string; full_name: string }[] };
  const nomesDasPessoas = new Map(((pessoas.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  const unidadesDoFiltro = [...new Set(todas.flatMap((m) => m.clinic_ids))]
    .map((id) => ({ id, nome: nomes.get(id) ?? "Unidade" }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    session,
    de,
    ate,
    unidade,
    nomeDaUnidade: unidade ? nomes.get(unidade) ?? "Unidade" : null,
    unidadesDoFiltro,
    erro,
    avisoDaLeitura,
    /** R4: o ranking entre pessoas é da gestão; os outros veem só a si. */
    gestao: podeCriarMeta(session),
    resultados: montarResultados(metas, linhas, nomes, nomesDasPessoas),
    geradoPor: session.fullName || session.email,
  };
}
