"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addDaysIso, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import { parseBRLToCents } from "@/lib/pricing";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointments";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/roles";
import {
  GRUPOS_DE_INDICADOR,
  INDICADORES_DE_META,
  ORIGENS_DA_VENDA,
  ORIGENS_DO_CLIENTE,
  ROTULO_DO_RECORTE,
  indicadorDe,
  rotuloDaDirecao,
  type Recorte,
  type UnidadeIndicador,
} from "@/lib/metas/indicadores";
import {
  ATINGIVEL_LABEL,
  MODO_LABEL,
  OBJETIVOS_ESTRATEGICOS,
  alvoDoSujeito,
  baseParaOPeriodo,
  diasEntre,
  formatarValor,
  fraseSmart,
  primeiroDoMes,
  resolverParticipantes,
  seloAtingivel,
  valorDe,
  type Candidato,
  type ModoDoAlvo,
  type RegraDeParticipante,
} from "@/lib/metas/regras";
import {
  buscarCandidatos,
  medirLinhaDeBase,
  publicarMeta,
  salvarMeta,
  type DadosDaMeta,
  type LinhaDeBase,
} from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-60";
const textareaClass = "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";

export type OpcoesDoAssistente = {
  podeRede: boolean;
  /** As unidades que a pessoa pode escolher. */
  unidades: { id: string; name: string }[];
  especialidades: string[];
  planosPpr: { id: string; name: string }[];
  hoje: string;
};

export type MetaInicial = {
  id: string;
  status: string;
  /** A meta já começou: a data de início não muda mais. */
  comecou: boolean;
  dados: DadosDaMeta;
};

type Filtros = {
  appointment_types: string[];
  sale_origin: string;
  specialties: string[];
  client_origins: string[];
  ppr_plans: string[];
};

type Form = {
  name: string;
  indicator: string;
  filtros: Filtros;
  scope: "network" | "clinics";
  clinic_ids: string[];
  how_text: string;
  rules: RegraDeParticipante[];
  direction: "increase" | "decrease";
  target_mode: ModoDoAlvo;
  target_value: string;
  individual_rule: "same" | "split";
  individual_value: string;
  stretch_value: string;
  /** "user:<id>" | "clinic:<id>" → valor digitado. */
  ajustes: Record<string, string>;
  resources_text: string;
  attainable_note: string;
  strategic_objective: string;
  relevance_text: string;
  periodicity: "whole" | "monthly";
  starts_on: string;
  ends_on: string;
  milestones: { label: string; indicator: string; due_on: string; target_value: string }[];
};

const PASSOS = [
  { letra: "S", nome: "Específica", pergunta: "O quê, onde, quem e como?" },
  { letra: "M", nome: "Mensurável", pergunta: "Qual número diz que chegamos?" },
  { letra: "A", nome: "Atingível", pergunta: "É realista com o que temos?" },
  { letra: "R", nome: "Relevante", pergunta: "Por que isso importa agora?" },
  { letra: "T", nome: "Temporal", pergunta: "Até quando?" },
  { letra: "✓", nome: "Revisão", pergunta: "A meta por extenso" },
] as const;

// ---------------------------------------------------------------- conversões
const REAIS = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function paraTexto(unidade: UnidadeIndicador, v: number | null | undefined): string {
  if (v == null) return "";
  const n = unidade === "brl" ? v / 100 : v;
  return unidade === "brl" ? REAIS.format(n) : String(n).replace(".", ",");
}

function lerNumero(unidade: UnidadeIndicador, s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (unidade === "brl") return parseBRLToCents(t);
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function filtrosVazios(): Filtros {
  return { appointment_types: [], sale_origin: "", specialties: [], client_origins: [], ppr_plans: [] };
}

function filtrosDoBanco(f: Record<string, unknown>): Filtros {
  const lista = (k: string) => (Array.isArray(f[k]) ? (f[k] as unknown[]).map(String) : []);
  return {
    appointment_types: lista("appointment_types"),
    sale_origin: typeof f.sale_origin === "string" ? f.sale_origin : "",
    specialties: lista("specialties"),
    client_origins: lista("client_origins"),
    ppr_plans: lista("ppr_plans"),
  };
}

/** Só os recortes que o indicador sabe aplicar, sem chave vazia. */
function filtrosParaOBanco(indicator: string, f: Filtros): Record<string, unknown> {
  const ind = indicadorDe(indicator);
  const out: Record<string, unknown> = {};
  for (const r of ind?.recortes ?? []) {
    const v = f[r];
    if (Array.isArray(v) ? v.length > 0 : Boolean(v)) out[r] = v;
  }
  return out;
}

function ultimoDoMesAtual(hoje: string): string {
  const [y, m] = hoje.split("-").map(Number);
  const prox = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDaysIso(prox, -1);
}

function formInicial(inicial: MetaInicial | null, opcoes: OpcoesDoAssistente): Form {
  if (!inicial) {
    const unica = !opcoes.podeRede && opcoes.unidades.length === 1;
    return {
      name: "",
      indicator: "",
      filtros: filtrosVazios(),
      scope: opcoes.podeRede ? "network" : "clinics",
      clinic_ids: unica ? [opcoes.unidades[0].id] : [],
      how_text: "",
      rules: [{ kind: "all" }],
      direction: "increase",
      target_mode: "collective",
      target_value: "",
      individual_rule: "same",
      individual_value: "",
      stretch_value: "",
      ajustes: {},
      resources_text: "",
      attainable_note: "",
      strategic_objective: "",
      relevance_text: "",
      periodicity: "whole",
      starts_on: opcoes.hoje,
      ends_on: ultimoDoMesAtual(opcoes.hoje),
      milestones: [],
    };
  }
  const d = inicial.dados;
  const u = indicadorDe(d.indicator)?.unidade ?? "count";
  return {
    name: d.name,
    indicator: d.indicator,
    filtros: filtrosDoBanco(d.filters),
    scope: d.scope,
    clinic_ids: d.clinic_ids,
    how_text: d.how_text ?? "",
    rules: d.rules,
    direction: d.direction,
    target_mode: d.target_mode,
    target_value: paraTexto(u, d.target_value),
    individual_rule: d.individual_rule ?? "same",
    individual_value: paraTexto(u, d.individual_value),
    stretch_value: paraTexto(u, d.stretch_value),
    ajustes: Object.fromEntries(d.targets.map((t) => [`${t.subject_kind}:${t.subject_id}`, paraTexto(u, t.target_value)])),
    resources_text: d.resources_text ?? "",
    attainable_note: d.attainable_note ?? "",
    strategic_objective: d.strategic_objective ?? "",
    relevance_text: d.relevance_text ?? "",
    periodicity: d.periodicity,
    starts_on: d.starts_on,
    ends_on: d.ends_on,
    milestones: d.milestones.map((m) => ({
      label: m.label,
      indicator: m.indicator,
      due_on: m.due_on,
      target_value: paraTexto(indicadorDe(m.indicator)?.unidade ?? "count", m.target_value),
    })),
  };
}

/**
 * A janela do histórico usada como linha de base. FOTOGRAFIA não tem
 * histórico guardado (N1): a base é o valor de HOJE.
 */
function janelaDoHistorico(
  f: Pick<Form, "periodicity" | "starts_on" | "ends_on">,
  tipo: string | undefined,
  hoje: string
): { from: string; to: string; meses: number } | null {
  if (tipo === "point") return { from: hoje, to: hoje, meses: 0 };
  if (!f.starts_on || !f.ends_on || f.ends_on < f.starts_on) return null;
  if (f.periodicity === "monthly") {
    // Os 3 meses cheios antes do início.
    const ate = addDaysIso(primeiroDoMes(f.starts_on), -1);
    let de = primeiroDoMes(ate);
    de = primeiroDoMes(addDaysIso(de, -1));
    de = primeiroDoMes(addDaysIso(de, -1));
    return { from: de, to: ate, meses: 3 };
  }
  const dias = diasEntre(f.starts_on, f.ends_on);
  const ate = addDaysIso(f.starts_on, -1);
  return { from: addDaysIso(ate, -(dias - 1)), to: ate, meses: 0 };
}

// ============================================================================
export function AssistenteDaMeta({
  opcoes,
  inicial,
}: {
  opcoes: OpcoesDoAssistente;
  inicial: MetaInicial | null;
}) {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [f, setF] = useState<Form>(() => formInicial(inicial, opcoes));
  const [motivo, setMotivo] = useState("");
  const [pendente, startTransition] = useTransition();
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [erroCandidatos, setErroCandidatos] = useState<string | null>(null);
  const [base, setBase] = useState<{ chave: string; base: LinhaDeBase | null; erro: string | null } | null>(null);
  const [buscaPessoa, setBuscaPessoa] = useState("");

  const publicada = Boolean(inicial && inicial.status !== "draft");
  const travado = publicada;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const ind = indicadorDe(f.indicator);
  const unidade: UnidadeIndicador = ind?.unidade ?? "count";
  const clinicasDaMeta = useMemo(
    () => (f.scope === "network" ? opcoes.unidades.map((u) => u.id) : f.clinic_ids),
    [f.scope, f.clinic_ids, opcoes.unidades]
  );
  const nomeDaUnidade = useMemo(() => new Map(opcoes.unidades.map((u) => [u.id, u.name])), [opcoes.unidades]);

  // ------------------------------------------------ candidatos (participantes)
  const chaveCandidatos = `${f.scope}|${[...f.clinic_ids].sort().join(",")}`;
  useEffect(() => {
    if (f.scope === "clinics" && f.clinic_ids.length === 0) return;
    let vivo = true;
    buscarCandidatos(f.scope, f.clinic_ids).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setCandidatos(r.candidatos);
        setErroCandidatos(null);
      } else {
        setCandidatos(null);
        setErroCandidatos(r.error);
      }
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveCandidatos]);

  const participantes = useMemo(
    () => (candidatos ? resolverParticipantes(f.rules, candidatos, clinicasDaMeta) : []),
    [candidatos, f.rules, clinicasDaMeta]
  );

  // ------------------------------------------------------- linha de base (A)
  const janela = janelaDoHistorico(f, ind?.tipo, opcoes.hoje);
  const filtrosBanco = filtrosParaOBanco(f.indicator, f.filtros);
  const chaveBase =
    ind && janela && (f.scope === "network" || f.clinic_ids.length > 0)
      ? JSON.stringify([f.indicator, filtrosBanco, f.scope, [...f.clinic_ids].sort(), janela.from, janela.to])
      : null;
  useEffect(() => {
    if (!chaveBase || !janela) return;
    let vivo = true;
    const t = setTimeout(() => {
      medirLinhaDeBase(f.indicator, filtrosBanco, f.scope, f.clinic_ids, janela.from, janela.to).then((r) => {
        if (!vivo) return;
        setBase(r.ok ? { chave: chaveBase, base: r.base, erro: null } : { chave: chaveBase, base: null, erro: r.error });
      });
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveBase]);
  const baseAtual = base && base.chave === chaveBase ? base : null;
  const valorDoHistorico = baseAtual?.base ? valorDe(baseAtual.base.total) : null;
  const baseDoPeriodo =
    ind && janela
      ? f.periodicity === "monthly"
        ? ind.tipo === "rate"
          ? valorDoHistorico
          : valorDoHistorico == null
            ? null
            : valorDoHistorico / janela.meses
        : baseParaOPeriodo(ind.tipo, valorDoHistorico, diasEntre(janela.from, janela.to), diasEntre(f.starts_on, f.ends_on))
      : null;
  const pessoasNoHistorico = baseAtual?.base?.people ?? 0;

  const alvo = lerNumero(unidade, f.target_value);
  const alvoIndividual = lerNumero(unidade, f.individual_value);
  const alvoComparado =
    f.target_mode === "individual" && f.individual_rule === "same"
      ? alvoIndividual
      : alvo;
  const baseComparada =
    f.target_mode === "individual" && f.individual_rule === "same" && ind?.tipo === "sum"
      ? pessoasNoHistorico > 0 && baseDoPeriodo != null
        ? baseDoPeriodo / pessoasNoHistorico
        : null
      : baseDoPeriodo;
  const selo = seloAtingivel(f.direction, alvoComparado, baseComparada);
  const exigeJustificativa = selo.nivel === "muito_acima";

  // ----------------------------------------------------------- completude
  const okS =
    f.name.trim() !== "" &&
    Boolean(ind) &&
    (f.scope === "network" || f.clinic_ids.length > 0) &&
    f.rules.length > 0 &&
    f.how_text.trim() !== "";
  const okM =
    (f.target_mode === "individual" || alvo != null) &&
    (f.target_mode === "collective" ||
      (f.individual_rule === "same" ? alvoIndividual != null : alvo != null));
  const okA = f.resources_text.trim() !== "" && (!exigeJustificativa || f.attainable_note.trim() !== "");
  const okR = f.strategic_objective !== "" && f.relevance_text.trim() !== "";
  const okT = Boolean(f.starts_on && f.ends_on && f.ends_on >= f.starts_on && f.ends_on >= opcoes.hoje);
  const completos = [okS, okM, okA, okR, okT];

  // ------------------------------------------------------------ frase SMART
  const recorteTexto = (() => {
    const partes: string[] = [];
    const fl = f.filtros;
    if (!ind) return "";
    if (ind.recortes.includes("specialties") && fl.specialties.length) partes.push(`de ${fl.specialties.join(", ")}`);
    if (ind.recortes.includes("appointment_types") && fl.appointment_types.length)
      partes.push(`(${fl.appointment_types.map((t) => APPOINTMENT_TYPE_LABELS[t as keyof typeof APPOINTMENT_TYPE_LABELS] ?? t).join(", ")})`);
    if (ind.recortes.includes("sale_origin") && fl.sale_origin)
      partes.push(fl.sale_origin === "plan" ? "de plano de tratamento" : "de venda direta");
    if (ind.recortes.includes("ppr_plans") && fl.ppr_plans.length)
      partes.push(`do plano ${fl.ppr_plans.map((id) => opcoes.planosPpr.find((p) => p.id === id)?.name ?? "").join(", ")}`);
    if (ind.recortes.includes("client_origins") && fl.client_origins.length)
      partes.push(`vindos de ${fl.client_origins.map((o) => ORIGENS_DO_CLIENTE.find((x) => x.value === o)?.label ?? o).join(", ")}`);
    return partes.join(" ");
  })();
  const ondeTexto =
    f.scope === "network"
      ? "na rede toda"
      : f.clinic_ids.length === 0
        ? "na unidade…"
        : `na${f.clinic_ids.length > 1 ? "s unidades" : ""} ${f.clinic_ids.map((id) => nomeDaUnidade.get(id) ?? "unidade").join(", ")}`;
  const quemTexto = (() => {
    const funcoes = f.rules.flatMap((r) => (r.kind === "role" ? [ROLE_LABELS[r.role]] : []));
    const pessoas = f.rules.flatMap((r) =>
      r.kind === "user" ? [candidatos?.find((c) => c.user_id === r.user_id)?.full_name ?? "uma pessoa"] : []
    );
    if (f.rules.some((r) => r.kind === "all")) return "com toda a equipe";
    const tudo = [...funcoes, ...pessoas];
    return tudo.length ? `com ${tudo.join(", ")}` : undefined;
  })();
  const frase = fraseSmart({
    indicador: ind,
    direction: f.direction,
    target_mode: f.target_mode,
    target_value: alvo,
    individual_rule: f.target_mode === "collective" ? null : f.individual_rule,
    individual_value: alvoIndividual,
    periodicity: f.periodicity,
    starts_on: f.starts_on || null,
    ends_on: f.ends_on || null,
    recorte: recorteTexto,
    onde: ondeTexto,
    quem: quemTexto,
  });

  // ---------------------------------------------------------------- enviar
  function dadosParaEnviar(): DadosDaMeta {
    const ajustes = Object.entries(f.ajustes)
      .map(([k, v]) => {
        const [kind, id] = k.split(":");
        const n = lerNumero(unidade, v);
        return n == null ? null : { subject_kind: kind as "user" | "clinic", subject_id: id, target_value: n };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // ajuste de pessoa só vale em meta com alvo individual; de unidade, com coletivo
      .filter((t) => (t.subject_kind === "user" ? f.target_mode !== "collective" : f.target_mode !== "individual"));
    return {
      name: f.name,
      indicator: f.indicator,
      filters: filtrosBanco,
      scope: f.scope,
      clinic_ids: f.scope === "network" ? [] : f.clinic_ids,
      how_text: f.how_text,
      direction: f.direction,
      target_mode: f.target_mode,
      target_value: f.target_mode === "individual" && f.individual_rule === "same" ? null : alvo,
      individual_rule: f.target_mode === "collective" ? null : f.individual_rule,
      individual_value: f.target_mode !== "collective" && f.individual_rule === "same" ? alvoIndividual : null,
      stretch_value: f.target_mode === "individual" ? null : lerNumero(unidade, f.stretch_value),
      baseline_value: baseDoPeriodo,
      baseline_from: janela?.from ?? null,
      baseline_to: janela?.to ?? null,
      resources_text: f.resources_text,
      attainable_note: f.attainable_note,
      strategic_objective: f.strategic_objective,
      relevance_text: f.relevance_text,
      periodicity: f.periodicity,
      starts_on: f.starts_on,
      ends_on: f.ends_on,
      rules: f.rules,
      targets: ajustes,
      milestones: f.milestones
        .map((m) => ({
          label: m.label,
          indicator: m.indicator,
          due_on: m.due_on,
          target_value: lerNumero(indicadorDe(m.indicator)?.unidade ?? "count", m.target_value) ?? NaN,
        }))
        .filter((m) => m.label.trim() && m.indicator && m.due_on && Number.isFinite(m.target_value)),
    };
  }

  function enviar(publicar: boolean) {
    if (publicada && !motivo.trim()) {
      toast.error("Escreva o motivo da alteração.");
      return;
    }
    if (publicar) {
      const falta = completos.findIndex((c) => !c);
      if (falta >= 0) {
        toast.error(`Falta completar o passo ${PASSOS[falta].letra} (${PASSOS[falta].nome}).`);
        setPasso(falta);
        return;
      }
    }
    startTransition(async () => {
      const r = await salvarMeta(inicial?.id ?? null, dadosParaEnviar(), publicada ? motivo : undefined);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (publicar) {
        const p = await publicarMeta(r.id);
        if (!p.ok) {
          toast.error(`Salva como rascunho, mas não publicada: ${p.error}`);
          router.push(`/metas/${r.id}`);
          return;
        }
        toast.success("Meta publicada.");
      } else {
        toast.success(publicada ? "Alteração registrada." : "Rascunho salvo.");
      }
      router.push(`/metas/${r.id}`);
      router.refresh();
    });
  }

  // ------------------------------------------------------------ pedaços de UI
  const avisoTravado = (texto: string) =>
    travado ? (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" aria-hidden /> {texto}
      </p>
    ) : null;

  function alternar(lista: string[], v: string): string[] {
    return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
  }

  function marcaveis(
    opcoesDoRecorte: { value: string; label: string }[],
    marcados: string[],
    onChange: (v: string[]) => void
  ) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {opcoesDoRecorte.map((o) => {
          const on = marcados.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              disabled={travado}
              onClick={() => onChange(alternar(marcados, o.value))}
              aria-pressed={on}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-60",
                on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  function recortes() {
    if (!ind || ind.recortes.length === 0) return null;
    const opcoesDe = (r: Recorte): { value: string; label: string }[] => {
      switch (r) {
        case "appointment_types":
          return Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
        case "specialties":
          return opcoes.especialidades.map((e) => ({ value: e, label: e }));
        case "client_origins":
          return ORIGENS_DO_CLIENTE.map((o) => ({ ...o }));
        case "ppr_plans":
          return opcoes.planosPpr.map((p) => ({ value: p.id, label: p.name }));
        case "sale_origin":
          return ORIGENS_DA_VENDA.map((o) => ({ ...o }));
      }
    };
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-3">
        <p className="text-xs text-muted-foreground">
          Recorte (opcional) — deixe em branco para contar tudo do indicador.
        </p>
        {ind.recortes.map((r) => (
          <div key={r} className="space-y-1.5">
            <Label>{ROTULO_DO_RECORTE[r]}</Label>
            {r === "sale_origin" ? (
              <select
                className={selectClass}
                disabled={travado}
                value={f.filtros.sale_origin}
                onChange={(e) => set("filtros", { ...f.filtros, sale_origin: e.target.value })}
              >
                <option value="">Todas as vendas</option>
                {opcoesDe(r).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              marcaveis(opcoesDe(r), f.filtros[r] as string[], (v) => set("filtros", { ...f.filtros, [r]: v }))
            )}
          </div>
        ))}
      </div>
    );
  }

  const regraTem = (k: RegraDeParticipante["kind"], v?: string) =>
    f.rules.some((r) => r.kind === k && (k === "all" || (r.kind === "role" ? r.role === v : r.kind === "user" ? r.user_id === v : false)));

  function alternarRegra(regra: RegraDeParticipante) {
    const igual = (r: RegraDeParticipante) =>
      r.kind === regra.kind &&
      (r.kind === "all" ||
        (r.kind === "role" && regra.kind === "role" && r.role === regra.role) ||
        (r.kind === "user" && regra.kind === "user" && r.user_id === regra.user_id));
    set("rules", f.rules.some(igual) ? f.rules.filter((r) => !igual(r)) : [...f.rules, regra]);
  }

  const funcoesDisponiveis = useMemo(() => {
    const presentes = new Set((candidatos ?? []).map((c) => c.role));
    return USER_ROLES.filter((r) => presentes.has(r));
  }, [candidatos]);

  const pessoasDisponiveis = useMemo(() => {
    const vistos = new Map<string, Candidato>();
    for (const c of candidatos ?? []) if (!vistos.has(c.user_id)) vistos.set(c.user_id, c);
    const q = buscaPessoa.trim().toLocaleLowerCase("pt-BR");
    return [...vistos.values()].filter((c) => !q || c.full_name.toLocaleLowerCase("pt-BR").includes(q)).slice(0, 40);
  }, [candidatos, buscaPessoa]);

  const nAlvoPessoas = participantes.length;
  const metaParaAlvo = {
    indicator: f.indicator,
    target_value: alvo,
    individual_rule: f.individual_rule,
    individual_value: alvoIndividual,
  };

  // ====================================================================== UI
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-5">
        {/* O stepper: as cinco letras, livres para navegar */}
        <ol className="grid grid-cols-6 gap-1.5" aria-label="Passos da meta SMART">
          {PASSOS.map((p, i) => {
            const feito = i < 5 ? completos[i] : completos.every(Boolean);
            return (
              <li key={p.letra}>
                <button
                  type="button"
                  onClick={() => setPasso(i)}
                  aria-current={i === passo ? "step" : undefined}
                  className={cn(
                    "flex w-full flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition",
                    i === passo ? "border-primary bg-primary/5" : "hover:border-primary/40"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-full text-sm font-bold",
                      feito ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {feito && i < 5 ? <Check className="size-4" aria-hidden /> : p.letra}
                  </span>
                  <span className="hidden text-xs sm:block">{p.nome}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          <header>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {PASSOS[passo].letra !== "✓" ? `${PASSOS[passo].letra} — ` : ""}
              {PASSOS[passo].nome}
            </p>
            <h2 className="text-lg font-semibold">{PASSOS[passo].pergunta}</h2>
          </header>

          {/* ------------------------------------------------------------ S */}
          {passo === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="nome">Nome da meta</Label>
                <Input
                  id="nome"
                  value={f.name}
                  maxLength={160}
                  placeholder="Ex.: Ortodontia — 1º trimestre"
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="indicador">O que vai ser medido (indicador)</Label>
                <select
                  id="indicador"
                  className={selectClass}
                  value={f.indicator}
                  disabled={travado}
                  onChange={(e) => {
                    const novo = indicadorDe(e.target.value);
                    setF((x) => ({
                      ...x,
                      indicator: e.target.value,
                      filtros: filtrosVazios(),
                      direction: novo?.direcoes[0] ?? "increase",
                      individual_rule: novo && novo.tipo !== "sum" ? "same" : x.individual_rule,
                      target_mode: novo && !novo.porPessoa ? "collective" : x.target_mode,
                      // Fotografia vale para o período inteiro (N1).
                      periodicity: novo?.tipo === "point" ? "whole" : x.periodicity,
                      stretch_value: novo?.limite ? "" : x.stretch_value,
                    }));
                  }}
                >
                  <option value="">Escolha…</option>
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
                {ind && (
                  <p className="text-xs text-muted-foreground">
                    {ind.ajuda} <span className="block">Onde acontece: {ind.onde}. Número de quem: {ind.quemConta}.</span>
                  </p>
                )}
                {avisoTravado("Depois de publicada, o indicador e o recorte não mudam — mudar seria outra meta.")}
              </div>

              {recortes()}

              <div className="space-y-1.5">
                <Label htmlFor="escopo">De onde os números vêm (abrangência)</Label>
                <select
                  id="escopo"
                  className={selectClass}
                  value={f.scope}
                  disabled={travado || !opcoes.podeRede}
                  onChange={(e) => {
                    const v = e.target.value as "network" | "clinics";
                    setF((x) => ({ ...x, scope: v, clinic_ids: v === "network" ? [] : x.clinic_ids, ajustes: {} }));
                  }}
                >
                  {opcoes.podeRede && <option value="network">Rede toda (todas as unidades somadas)</option>}
                  <option value="clinics">{opcoes.podeRede ? "Unidades escolhidas" : "A minha unidade"}</option>
                </select>
                {f.scope === "clinics" && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {opcoes.unidades.map((u) => {
                      const on = f.clinic_ids.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          disabled={travado}
                          aria-pressed={on}
                          onClick={() =>
                            set(
                              "clinic_ids",
                              opcoes.podeRede ? alternar(f.clinic_ids, u.id) : on ? [] : [u.id]
                            )
                          }
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-60",
                            on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40"
                          )}
                        >
                          {u.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!opcoes.podeRede && (
                  <p className="text-xs text-muted-foreground">
                    Gerente e Franqueado criam metas da própria unidade. Metas da rede são criadas pela Franqueadora.
                  </p>
                )}
                {avisoTravado("Depois de publicada, a abrangência não muda.")}
              </div>

              <div className="space-y-2">
                <Label>Quem participa</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    aria-pressed={regraTem("all")}
                    onClick={() => alternarRegra({ kind: "all" })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs",
                      regraTem("all") ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                    )}
                  >
                    Toda a equipe {f.scope === "network" ? "das unidades" : "da unidade"}
                  </button>
                  {funcoesDisponiveis.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={regraTem("role", r)}
                      onClick={() => alternarRegra({ kind: "role", role: r as UserRole })}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        regraTem("role", r) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                      )}
                    >
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
                <details className="rounded-lg border p-2 text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Escolher pessoas ({f.rules.filter((r) => r.kind === "user").length} escolhida(s))
                  </summary>
                  <Input
                    className="mt-2"
                    placeholder="Procurar pelo nome"
                    value={buscaPessoa}
                    onChange={(e) => setBuscaPessoa(e.target.value)}
                  />
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {pessoasDisponiveis.map((c) => (
                      <li key={c.user_id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={regraTem("user", c.user_id)}
                            onChange={() => alternarRegra({ kind: "user", user_id: c.user_id })}
                          />
                          {c.full_name}
                          <span className="text-xs text-muted-foreground">
                            {ROLE_LABELS[c.role as UserRole] ?? c.role}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </details>
                <p className="text-xs text-muted-foreground">
                  {erroCandidatos
                    ? erroCandidatos
                    : candidatos == null
                      ? "Escolha a unidade para ver a equipe."
                      : `${participantes.length} participante(s) hoje. Quem entra na equipe ou na função durante a meta entra na meta.`}
                </p>
                {ind?.porPessoa && !f.rules.some((r) => r.kind === "all") && (
                  <p className="text-xs text-muted-foreground">
                    Com participantes escolhidos, a meta conta só o que eles fizeram ({ind.quemConta}).
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="como">Como vamos fazer (plano de ação)</Label>
                <textarea
                  id="como"
                  className={textareaClass}
                  value={f.how_text}
                  placeholder="Ex.: ligar para os clientes avaliados que não fecharam; campanha no Instagram; uma conversa por semana com a equipe."
                  onChange={(e) => set("how_text", e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------ M */}
          {passo === 1 && (
            <div className="space-y-4">
              {!ind ? (
                <p className="text-sm text-muted-foreground">Escolha o indicador no passo S primeiro.</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="direcao">Direção</Label>
                      <select
                        id="direcao"
                        className={selectClass}
                        value={f.direction}
                        disabled={travado || ind.direcoes.length === 1}
                        onChange={(e) => set("direction", e.target.value as "increase" | "decrease")}
                      >
                        {ind.direcoes.map((d) => (
                          <option key={d} value={d}>
                            {rotuloDaDirecao(ind, d)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="modo">Tipo de meta</Label>
                      <select
                        id="modo"
                        className={selectClass}
                        value={f.target_mode}
                        disabled={travado || !ind.porPessoa}
                        onChange={(e) => set("target_mode", e.target.value as ModoDoAlvo)}
                      >
                        {(Object.keys(MODO_LABEL) as ModoDoAlvo[]).map((m) => (
                          <option key={m} value={m}>
                            {MODO_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      {!ind.porPessoa && (
                        <p className="text-xs text-muted-foreground">Este indicador não tem dono por pessoa: só coletiva.</p>
                      )}
                    </div>
                  </div>

                  {f.target_mode !== "collective" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="regra">O alvo de cada participante</Label>
                      <select
                        id="regra"
                        className={selectClass}
                        value={f.individual_rule}
                        onChange={(e) => set("individual_rule", e.target.value as "same" | "split")}
                      >
                        <option value="same">O mesmo alvo para cada um</option>
                        {ind.tipo === "sum" && <option value="split">Um total dividido entre os participantes</option>}
                      </select>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    {(f.target_mode !== "individual" || f.individual_rule === "split") && (
                      <div className="space-y-1.5">
                        <Label htmlFor="alvo">
                          {f.target_mode === "individual" ? "Total a dividir" : "Valor-alvo"}
                          {unidade === "brl" ? " (R$)" : unidade === "percent" ? " (%)" : ""}
                          {f.periodicity === "monthly" ? " por mês" : ""}
                        </Label>
                        <Input
                          id="alvo"
                          inputMode="decimal"
                          value={f.target_value}
                          onChange={(e) => set("target_value", e.target.value)}
                        />
                      </div>
                    )}
                    {f.target_mode !== "collective" && f.individual_rule === "same" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="alvoind">
                          Alvo de cada participante{unidade === "brl" ? " (R$)" : unidade === "percent" ? " (%)" : ""}
                        </Label>
                        <Input
                          id="alvoind"
                          inputMode="decimal"
                          value={f.individual_value}
                          onChange={(e) => set("individual_value", e.target.value)}
                        />
                      </div>
                    )}
                    {f.target_mode !== "individual" && !ind.limite && (
                      <div className="space-y-1.5">
                        <Label htmlFor="super">Super Meta (opcional)</Label>
                        <Input
                          id="super"
                          inputMode="decimal"
                          value={f.stretch_value}
                          placeholder={f.direction === "decrease" ? "Ex.: um valor ainda menor" : "Ex.: 20% acima do alvo"}
                          onChange={(e) => set("stretch_value", e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {/* D2: ajuste por unidade */}
                  {f.target_mode !== "individual" && clinicasDaMeta.length > 1 && (
                    <details className="rounded-lg border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Alvo de cada unidade ({clinicasDaMeta.length} unidades)
                      </summary>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ind.tipo === "sum"
                          ? "Sem ajuste, o alvo é dividido igualmente. Ajuste as unidades que têm porte diferente."
                          : "Sem ajuste, cada unidade tem o mesmo alvo da meta."}
                      </p>
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                        {clinicasDaMeta.map((id) => {
                          const padrao = alvoDoSujeito(metaParaAlvo, "clinic", id, clinicasDaMeta.length, []);
                          return (
                            <li key={id} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate">{nomeDaUnidade.get(id) ?? "Unidade"}</span>
                              <Input
                                className="w-32"
                                inputMode="decimal"
                                value={f.ajustes[`clinic:${id}`] ?? ""}
                                placeholder={padrao == null ? "" : paraTexto(unidade, padrao)}
                                onChange={(e) => set("ajustes", { ...f.ajustes, [`clinic:${id}`]: e.target.value })}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}

                  {/* Ajuste por pessoa */}
                  {f.target_mode !== "collective" && participantes.length > 0 && (
                    <details className="rounded-lg border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Alvo de cada participante ({participantes.length})
                      </summary>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Deixe em branco para usar a regra. Quem entrar depois recebe a regra.
                      </p>
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                        {participantes.map((p) => {
                          const padrao = alvoDoSujeito(metaParaAlvo, "user", p.user_id, nAlvoPessoas, []);
                          return (
                            <li key={p.user_id} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                              <Input
                                className="w-32"
                                inputMode="decimal"
                                value={f.ajustes[`user:${p.user_id}`] ?? ""}
                                placeholder={padrao == null ? "" : paraTexto(unidade, padrao)}
                                onChange={(e) => set("ajustes", { ...f.ajustes, [`user:${p.user_id}`]: e.target.value })}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------ A */}
          {passo === 2 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                {!ind || !janela ? (
                  <p className="text-muted-foreground">Escolha o indicador (S) e o prazo (T) para comparar com o histórico.</p>
                ) : baseAtual?.erro ? (
                  <p className="text-amber-700 dark:text-amber-300">
                    Não foi possível ler o histórico agora: {baseAtual.erro}
                  </p>
                ) : !baseAtual ? (
                  <p className="text-muted-foreground">Lendo o histórico…</p>
                ) : (
                  <div className="space-y-2">
                    {ind.tipo === "point" ? (
                      <p>
                        <span className="text-muted-foreground">Valor de hoje: </span>
                        <strong>{formatarValor(unidade, valorDoHistorico)}</strong>
                        <span className="text-muted-foreground"> (é a linha de base: a fotografia não tem histórico guardado)</span>
                      </p>
                    ) : (
                    <p>
                      <span className="text-muted-foreground">Histórico ({formatIsoDateBr(janela.from)} a {formatIsoDateBr(janela.to)}): </span>
                      <strong>{formatarValor(unidade, valorDoHistorico)}</strong>
                      {f.periodicity === "monthly" && ind.tipo === "sum" && (
                        <span className="text-muted-foreground"> · média de {formatarValor(unidade, baseDoPeriodo)} por mês</span>
                      )}
                      {f.periodicity === "whole" && ind.tipo === "sum" && (
                        <span className="text-muted-foreground">
                          {" "}
                          · no mesmo ritmo, o período da meta daria {formatarValor(unidade, baseDoPeriodo)}
                        </span>
                      )}
                    </p>
                    )}
                    {baseAtual.base && baseAtual.base.by_month.length > 1 && (
                      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {baseAtual.base.by_month.map((m) => (
                          <li key={m.month}>
                            {formatIsoMonthBr(m.month)}: {formatarValor(unidade, valorDe(m))}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p>
                      Selo:{" "}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          selo.nivel === "realista" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
                          selo.nivel === "desafiador" && "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                          selo.nivel === "muito_acima" && "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
                          selo.nivel === "sem_historico" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {ATINGIVEL_LABEL[selo.nivel]}
                      </span>
                      {selo.melhora != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          — o alvo pede {Math.round(selo.melhora * 100)}% {selo.melhora >= 0 ? "de melhora" : "a menos"} sobre o histórico
                          {f.target_mode === "individual" && f.individual_rule === "same" && ind.tipo === "sum"
                            ? ` (média por pessoa ativa no histórico: ${pessoasNoHistorico})`
                            : ""}
                          .
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="recursos">Recursos e apoio que a equipe terá</Label>
                <textarea
                  id="recursos"
                  className={textareaClass}
                  value={f.resources_text}
                  placeholder="Ex.: verba de R$ 1.500 para anúncios; 2 horas por semana de agenda do consultor reservadas para retornos."
                  onChange={(e) => set("resources_text", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="just">
                  Por que é possível chegar lá{exigeJustificativa ? " (obrigatório: o alvo está muito acima do histórico)" : " (opcional)"}
                </Label>
                <textarea
                  id="just"
                  className={textareaClass}
                  value={f.attainable_note}
                  onChange={(e) => set("attainable_note", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Meta impossível desmotiva a equipe. Até 10% acima do histórico é realista; até 30%, desafiador.
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------ R */}
          {passo === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="objetivo">Objetivo estratégico</Label>
                <select
                  id="objetivo"
                  className={selectClass}
                  value={f.strategic_objective}
                  onChange={(e) => set("strategic_objective", e.target.value)}
                >
                  <option value="">Escolha…</option>
                  {OBJETIVOS_ESTRATEGICOS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="porque">Por que esta meta importa agora</Label>
                <textarea
                  id="porque"
                  className={textareaClass}
                  value={f.relevance_text}
                  placeholder="Ex.: a cadeira de ortodontia está ociosa às tardes, e o trimestre é o de maior procura do ano."
                  onChange={(e) => set("relevance_text", e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------ T */}
          {passo === 4 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inicio">Início</Label>
                  <Input
                    id="inicio"
                    type="date"
                    value={f.starts_on}
                    disabled={Boolean(inicial?.comecou)}
                    onChange={(e) => set("starts_on", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fim">Fim</Label>
                  <Input id="fim" type="date" value={f.ends_on} min={opcoes.hoje} onChange={(e) => set("ends_on", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="periodicidade">O alvo vale</Label>
                  <select
                    id="periodicidade"
                    className={selectClass}
                    value={f.periodicity}
                    disabled={travado || ind?.tipo === "point"}
                    onChange={(e) => set("periodicity", e.target.value as "whole" | "monthly")}
                  >
                    <option value="whole">Para o período inteiro</option>
                    <option value="monthly">Para cada mês do período</option>
                  </select>
                </div>
              </div>
              {f.starts_on && f.ends_on && f.ends_on < f.starts_on && (
                <p className="text-sm text-destructive">O fim não pode vir antes do início.</p>
              )}
              {f.ends_on && f.ends_on < opcoes.hoje && (
                <p className="text-sm text-destructive">O fim não pode ficar no passado.</p>
              )}
              {inicial?.comecou && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3" aria-hidden /> A meta já começou: o início não muda mais.
                </p>
              )}
              {ind?.tipo === "point" && (
                <p className="text-xs text-muted-foreground">
                  {ind.rotulo} é uma fotografia: vale o número de cada dia. O sistema guarda uma foto por dia, e o
                  resultado da meta é o valor do último dia do prazo.
                </p>
              )}
              {f.periodicity === "monthly" && (
                <p className="text-xs text-muted-foreground">
                  Cada mês é apurado e congelado no fim dele. A meta é atingida quando todos os meses atingem o alvo.
                </p>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Marcos intermediários (opcional)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      set("milestones", [
                        ...f.milestones,
                        { label: "", indicator: f.indicator, due_on: f.ends_on, target_value: "" },
                      ])
                    }
                  >
                    <Plus className="mr-1 size-3.5" /> Marco
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Ex.: &ldquo;1º mês com pelo menos 20 novos clientes&rdquo;. O marco é medido do início da meta até a data dele.
                </p>
                {f.milestones.map((m, i) => {
                  const upd = (patch: Partial<typeof m>) =>
                    set("milestones", f.milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_12rem_9rem_7rem_auto]">
                      <Input placeholder="Descrição do marco" value={m.label} onChange={(e) => upd({ label: e.target.value })} />
                      <select className={selectClass} value={m.indicator} onChange={(e) => upd({ indicator: e.target.value })}>
                        <option value="">Indicador…</option>
                        {INDICADORES_DE_META.filter((x) => x.tipo === "sum" && !x.limite).map((x) => (
                          <option key={x.chave} value={x.chave}>
                            {x.rotulo}
                          </option>
                        ))}
                      </select>
                      <Input type="date" value={m.due_on} onChange={(e) => upd({ due_on: e.target.value })} />
                      <Input
                        inputMode="decimal"
                        placeholder="Alvo"
                        value={m.target_value}
                        onChange={(e) => upd({ target_value: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Tirar o marco"
                        onClick={() => set("milestones", f.milestones.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------- Revisão */}
          {passo === 5 && (
            <div className="space-y-4">
              <blockquote className="rounded-lg border-l-4 border-gold bg-muted/40 p-4 text-base font-medium">{frase}</blockquote>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {PASSOS.slice(0, 5).map((p, i) => (
                  <li key={p.letra}>
                    <button
                      type="button"
                      onClick={() => setPasso(i)}
                      className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:border-primary/40"
                    >
                      <span
                        className={cn(
                          "grid size-6 place-items-center rounded-full text-xs font-bold",
                          completos[i] ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
                        )}
                      >
                        {completos[i] ? <Check className="size-3.5" aria-hidden /> : "!"}
                      </span>
                      <span>
                        <strong>{p.letra}</strong> — {p.nome}
                        {!completos[i] && <span className="block text-xs text-muted-foreground">Falta completar</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {publicada && (
                <div className="space-y-1.5">
                  <Label htmlFor="motivo">Motivo da alteração (obrigatório — fica no histórico da meta)</Label>
                  <textarea
                    id="motivo"
                    className={textareaClass}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {publicada ? (
                  <Button type="button" disabled={pendente} onClick={() => enviar(false)}>
                    Salvar alteração
                  </Button>
                ) : (
                  <>
                    <Button type="button" disabled={pendente} onClick={() => enviar(true)}>
                      Publicar meta
                    </Button>
                    <Button type="button" variant="outline" disabled={pendente} onClick={() => enviar(false)}>
                      Salvar rascunho
                    </Button>
                  </>
                )}
              </div>
              {!publicada && (
                <p className="text-xs text-muted-foreground">
                  Rascunho fica visível só para quem pode editar. Publicada, a meta aparece para os participantes — e começa
                  sozinha na data de início.
                </p>
              )}
            </div>
          )}

          <footer className="flex justify-between border-t pt-4">
            <Button type="button" variant="ghost" disabled={passo === 0} onClick={() => setPasso((p) => p - 1)}>
              <ChevronLeft className="mr-1 size-4" /> Voltar
            </Button>
            {passo < 5 && (
              <Button type="button" variant="outline" onClick={() => setPasso((p) => p + 1)}>
                Próximo <ChevronRight className="ml-1 size-4" />
              </Button>
            )}
          </footer>
        </section>
      </div>

      {/* A frase ao vivo, sempre à vista */}
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">A meta por extenso</p>
          <p className="mt-2 text-sm font-medium">{frase}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground shadow-sm">
          <p className="font-semibold text-foreground">SMART</p>
          <ul className="mt-1 space-y-0.5">
            <li><strong>S</strong>pecífica — o quê, quem e como.</li>
            <li><strong>M</strong>ensurável — um número que diz se chegou.</li>
            <li><strong>A</strong>tingível — realista com os recursos.</li>
            <li><strong>R</strong>elevante — importa para o negócio agora.</li>
            <li><strong>T</strong>emporal — tem prazo.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

