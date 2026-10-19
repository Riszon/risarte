import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lerTodasAsPaginas } from "@/lib/paginar";
import { cn } from "@/lib/utils";
import type { RegraDoProcedimento } from "@/lib/odontograma/referencia";
import {
  AbaFaces,
  AbaProcedimentos,
  AbaRegioes,
  AbaSituacoes,
  type DenteNaTela,
  type ProcedimentoNaTela,
  type RegiaoNaTela,
  type SituacaoNaTela,
} from "./abas";

export const metadata: Metadata = { title: "Odontograma" };

const ABAS = [
  { id: "situacoes", rotulo: "Situações do dente" },
  { id: "faces", rotulo: "Faces dos dentes" },
  { id: "regioes", rotulo: "Regiões" },
  { id: "procedimentos", rotulo: "Procedimentos" },
] as const;

/**
 * Administração → Odontograma (OD1, 0308). O que veio dos arquivos TUSS e
 * das planilhas que o dono revisou, ajustável aqui (pedido do dono,
 * 19/10/2026). Código e nome oficiais da TUSS não mudam; nada se apaga.
 */
export default async function OdontogramaAdminPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminMaster();
  const sp = await props.searchParams;
  const aba = ABAS.some((a) => a.id === sp.aba) ? (sp.aba as (typeof ABAS)[number]["id"]) : "situacoes";
  const supabase = await createClient();

  const [cond, faces, dentes, ligFaces, regioes, ligRegioes] = await Promise.all([
    supabase.from("dental_conditions").select("code, name, source, applies_to, usage, symbol, sort_order, is_active").order("sort_order").order("code"),
    supabase.from("dental_faces").select("code, name").order("code"),
    supabase.from("dental_teeth").select("code, name, dentition, arch, tooth_group").order("code"),
    supabase.from("dental_tooth_faces").select("tooth_code, face_code"),
    supabase.from("dental_regions").select("code, name").order("code"),
    supabase.from("dental_region_teeth").select("region_code, tooth_code"),
  ]);
  const falhou = [cond, faces, dentes, ligFaces, regioes, ligRegioes].find((r) => r.error);
  if (falhou) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">Odontograma</h1>
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {/does not exist|schema cache/i.test(falhou.error?.message ?? "")
            ? "O banco ainda não recebeu a atualização 0308 — esta tela aparece depois dela."
            : "Não foi possível ler a configuração do odontograma agora. Nada foi alterado."}
        </p>
      </div>
    );
  }

  const situacoes: SituacaoNaTela[] = (cond.data ?? []).map((c) => ({
    code: c.code, name: c.name, source: c.source, appliesTo: c.applies_to, usage: c.usage,
    symbol: c.symbol, isActive: c.is_active,
  }));
  const facesPorDente = new Map<string, string[]>();
  for (const l of ligFaces.data ?? []) {
    const lista = facesPorDente.get(l.tooth_code) ?? [];
    lista.push(l.face_code);
    facesPorDente.set(l.tooth_code, lista);
  }
  const listaDeDentes: DenteNaTela[] = (dentes.data ?? [])
    .map((d) => ({ code: d.code, name: d.name, dentition: d.dentition, arch: d.arch, group: d.tooth_group, faces: facesPorDente.get(d.code) ?? [] }))
    .sort((a, b) => Number(a.code) - Number(b.code));
  const dentesPorRegiao = new Map<string, string[]>();
  for (const l of ligRegioes.data ?? []) {
    const lista = dentesPorRegiao.get(l.region_code) ?? [];
    lista.push(l.tooth_code);
    dentesPorRegiao.set(l.region_code, lista);
  }
  const listaDeRegioes: RegiaoNaTela[] = (regioes.data ?? []).map((r) => ({
    code: r.code, name: r.name,
    teeth: (dentesPorRegiao.get(r.code) ?? []).sort((a, b) => Number(a) - Number(b)),
  }));

  // Procedimentos e regras: só na aba deles (são centenas).
  let procedimentos: ProcedimentoNaTela[] = [];
  let erroDosProcedimentos = false;
  if (aba === "procedimentos") {
    const [procs, regras] = await Promise.all([
      lerTodasAsPaginas<{ id: string; code: string | null; tuss_code: string | null; name: string; specialty: string | null; is_active: boolean }>(
        (de, ate) => supabase.from("procedures").select("id, code, tuss_code, name, specialty, is_active").order("name").range(de, ate)
      ),
      lerTodasAsPaginas<{
        procedure_id: string; application_level: string; face_count_min: number | null; face_count_max: number | null;
        fixed_faces: string[]; dentition: string; tooth_groups: string[]; blocked_conditions: string[];
        required_conditions: string[]; effect_condition: string | null; effect_when_absent: string | null; confidence: string | null;
      }>((de, ate) => supabase.from("procedure_dental_rules").select("*").range(de, ate)),
    ]);
    if (!procs.ok || !regras.ok) {
      erroDosProcedimentos = true;
    } else {
      const porId = new Map(regras.linhas.map((r) => [r.procedure_id, r]));
      procedimentos = procs.linhas.map((p) => {
        const r = porId.get(p.id);
        const regra: RegraDoProcedimento | null = r
          ? {
              level: r.application_level as RegraDoProcedimento["level"],
              faceCountMin: r.face_count_min, faceCountMax: r.face_count_max, fixedFaces: r.fixed_faces,
              dentition: r.dentition as RegraDoProcedimento["dentition"],
              toothGroups: r.tooth_groups as RegraDoProcedimento["toothGroups"],
              blockedConditions: r.blocked_conditions, requiredConditions: r.required_conditions,
              effectCondition: r.effect_condition, effectWhenAbsent: r.effect_when_absent,
            }
          : null;
        return {
          id: p.id, code: p.code, tussCode: p.tuss_code, name: p.name, specialty: p.specialty,
          isActive: p.is_active, regra, confianca: r?.confidence ?? null,
        };
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Odontograma</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A base do odontograma: dentes, faces e regiões (TUSS), as situações do
          dente e a regra clínica de cada procedimento. Veio dos arquivos TUSS e
          das planilhas revisadas; ajuste aqui quando precisar. O que é{" "}
          <strong>oficial da TUSS</strong> (código e nome) não muda, e{" "}
          <strong>nada se apaga</strong> — situação se desativa; procedimento que
          não aparece no dente fica como &quot;sem marcação&quot;.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b">
        {ABAS.map((a) => (
          <Link
            key={a.id}
            href={`/admin/odontograma?aba=${a.id}`}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm",
              aba === a.id ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      {aba === "situacoes" && <AbaSituacoes situacoes={situacoes} />}
      {aba === "faces" && <AbaFaces dentes={listaDeDentes} faces={faces.data ?? []} />}
      {aba === "regioes" && <AbaRegioes regioes={listaDeRegioes} dentes={listaDeDentes} />}
      {aba === "procedimentos" &&
        (erroDosProcedimentos ? (
          <p className="text-sm text-destructive">Não foi possível ler os procedimentos agora. Nada foi alterado.</p>
        ) : (
          <AbaProcedimentos procedimentos={procedimentos} situacoes={situacoes} faces={faces.data ?? []} />
        ))}
    </div>
  );
}
