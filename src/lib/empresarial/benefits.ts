import "server-only";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "./db";
import type { BenefitType } from "./constants";

export type ProgramBenefit = {
  procedureId: string;
  benefitType: BenefitType;
  benefitValue: number | null;
  available: boolean;
  blockedReason: string | null;
};

export type ClientProgram = {
  active: boolean;
  companyId: string | null;
  companyName: string | null;
  byProcedure: Record<string, ProgramBenefit>;
};

const EMPTY: ClientProgram = {
  active: false,
  companyId: null,
  companyName: null,
  byProcedure: {},
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

type BenefitRow = {
  procedure_id: string;
  company_id: string | null;
  benefit_type: BenefitType;
  benefit_value: number | null;
  usage_limit_count: number | null;
  usage_period_months: number | null;
  grace_period_months: number;
};

/**
 * Resolve os benefícios efetivos do cliente no programa: cobertura por
 * procedimento (empresa > rede), aplicando carência (empresa/colaborador/
 * benefício) e frequência/limite pelo histórico de uso. Usado no orçamento.
 */
export async function loadClientProgram(
  clientId: string
): Promise<ClientProgram> {
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("empresarial_company_id, empresarial_active")
    .eq("id", clientId)
    .maybeSingle();
  if (!client?.empresarial_company_id || client.empresarial_active === false) {
    return EMPTY;
  }
  const companyId = client.empresarial_company_id as string;

  const db = await empresarialDb();
  const [
    { data: company },
    { data: emp },
    { data: dep },
    { data: benRows },
    { data: usage },
  ] = await Promise.all([
    db
      .from("companies")
      .select(
        "legal_name, trade_name, status, contract_started_at, grace_period_days, employee_grace_period_days"
      )
      .eq("id", companyId)
      .maybeSingle(),
    db
      .from("employees")
      .select("joined_at, grace_period_days")
      .eq("client_id", clientId)
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("dependents")
      .select("employee_id")
      .eq("client_id", clientId)
      .maybeSingle(),
    db
      .from("procedure_benefits")
      .select(
        "procedure_id, company_id, benefit_type, benefit_value, usage_limit_count, usage_period_months, grace_period_months"
      )
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .returns<BenefitRow[]>(),
    db
      .from("benefit_usage")
      .select("procedure_id, used_at")
      .eq("client_id", clientId)
      .returns<{ procedure_id: string; used_at: string }[]>(),
  ]);

  // Data de entrada do colaborador (titular ou, para dependente, do seu titular).
  let joinedAt: Date | null = emp?.joined_at ? new Date(emp.joined_at) : null;
  let employeeGraceDays: number | null = emp?.grace_period_days ?? null;
  if (!joinedAt && dep?.employee_id) {
    const { data: holder } = await db
      .from("employees")
      .select("joined_at, grace_period_days")
      .eq("id", dep.employee_id)
      .maybeSingle();
    if (holder?.joined_at) joinedAt = new Date(holder.joined_at);
    employeeGraceDays = holder?.grace_period_days ?? null;
  }

  const companyName =
    company?.trade_name || company?.legal_name || null;
  // Inadimplência (5.4): empresa suspensa/encerrada → benefícios bloqueados
  // para NOVOS orçamentos (tratamentos já aprovados seguem, fora daqui).
  const companyBlocked = company?.status && company.status !== "ACTIVE";
  const now = new Date();

  // Carência da empresa e do colaborador (as que independem do benefício).
  const companyGraceUntil =
    company?.contract_started_at && (company?.grace_period_days ?? 0) > 0
      ? addDays(new Date(company.contract_started_at), company.grace_period_days)
      : null;
  const empGraceDays = employeeGraceDays ?? company?.employee_grace_period_days ?? 0;
  const employeeGraceUntil =
    joinedAt && empGraceDays > 0 ? addDays(joinedAt, empGraceDays) : null;

  // Escolhe a linha da EMPRESA quando existir; senão a da REDE.
  const chosen = new Map<string, BenefitRow>();
  for (const r of benRows ?? []) {
    const cur = chosen.get(r.procedure_id);
    if (!cur || (r.company_id === companyId && cur.company_id === null)) {
      chosen.set(r.procedure_id, r);
    }
  }

  const usageByProc = new Map<string, Date[]>();
  for (const u of usage ?? []) {
    const list = usageByProc.get(u.procedure_id) ?? [];
    list.push(new Date(u.used_at));
    usageByProc.set(u.procedure_id, list);
  }

  const byProcedure: Record<string, ProgramBenefit> = {};
  for (const [procedureId, b] of chosen) {
    // Carência específica do benefício.
    const benefitGraceUntil =
      joinedAt && b.grace_period_months > 0
        ? addMonths(joinedAt, b.grace_period_months)
        : null;
    const graceUntil = [companyGraceUntil, employeeGraceUntil, benefitGraceUntil]
      .filter((d): d is Date => d !== null)
      .sort((a, z) => z.getTime() - a.getTime())[0];

    let available = true;
    let blockedReason: string | null = null;

    if (companyBlocked) {
      available = false;
      blockedReason = "Empresa suspensa (inadimplência) — benefício bloqueado.";
    } else if (graceUntil && now < graceUntil) {
      available = false;
      blockedReason = `Em carência até ${fmt(graceUntil)}.`;
    }

    // Frequência / limite de usos.
    if (available) {
      const effLimit =
        b.usage_limit_count ?? (b.usage_period_months ? 1 : null);
      if (effLimit != null) {
        const all = (usageByProc.get(procedureId) ?? []).sort(
          (a, z) => a.getTime() - z.getTime()
        );
        const windowStart = b.usage_period_months
          ? addMonths(now, -b.usage_period_months)
          : null;
        const relevant = windowStart
          ? all.filter((d) => d >= windowStart)
          : all;
        if (relevant.length >= effLimit) {
          available = false;
          if (b.usage_period_months && relevant[0]) {
            const next = addMonths(relevant[0], b.usage_period_months);
            blockedReason = `Já utilizado. Disponível a partir de ${fmt(next)}.`;
          } else {
            blockedReason = "Limite de usos do benefício atingido.";
          }
        }
      }
    }

    byProcedure[procedureId] = {
      procedureId,
      benefitType: b.benefit_type,
      benefitValue: b.benefit_value,
      available,
      blockedReason,
    };
  }

  return { active: true, companyId, companyName, byProcedure };
}

export type ClientUsageSummary = {
  active: boolean;
  companyName: string | null;
  totalSavedCents: number;
  usageCount: number;
  usages: {
    procedureName: string;
    usedAt: string;
    savedCents: number;
  }[];
  /** Benefícios do plano ainda disponíveis (para incentivar o uso). */
  available: { procedureName: string; description: string }[];
  /** Benefícios bloqueados agora (carência/frequência) e o porquê. */
  blocked: { procedureName: string; reason: string }[];
};

/**
 * Painel "uso e economia" do cliente (Fase 7): o que já usou, quanto economizou
 * e os benefícios disponíveis/bloqueados agora.
 */
export async function loadClientUsage(
  clientId: string
): Promise<ClientUsageSummary> {
  const program = await loadClientProgram(clientId);
  if (!program.active) {
    return {
      active: false,
      companyName: null,
      totalSavedCents: 0,
      usageCount: 0,
      usages: [],
      available: [],
      blocked: [],
    };
  }

  const db = await empresarialDb();
  const supabase = await createClient();
  const { data: usageRows } = await db
    .from("benefit_usage")
    .select("procedure_id, used_at, amount_saved_cents")
    .eq("client_id", clientId)
    .order("used_at", { ascending: false })
    .returns<
      { procedure_id: string; used_at: string; amount_saved_cents: number | null }[]
    >();

  const procIds = [
    ...new Set([
      ...(usageRows ?? []).map((u) => u.procedure_id),
      ...Object.keys(program.byProcedure),
    ]),
  ];
  const nameById = new Map<string, string>();
  if (procIds.length) {
    const { data: procs } = await supabase
      .from("procedures")
      .select("id, name")
      .in("id", procIds);
    for (const p of procs ?? []) nameById.set(p.id, p.name);
  }

  let totalSaved = 0;
  const usages = (usageRows ?? []).map((u) => {
    totalSaved += u.amount_saved_cents ?? 0;
    return {
      procedureName: nameById.get(u.procedure_id) ?? "Procedimento",
      usedAt: u.used_at,
      savedCents: u.amount_saved_cents ?? 0,
    };
  });

  const available: { procedureName: string; description: string }[] = [];
  const blocked: { procedureName: string; reason: string }[] = [];
  for (const b of Object.values(program.byProcedure)) {
    if (b.benefitType === "NOT_COVERED") continue;
    const name = nameById.get(b.procedureId) ?? "Procedimento";
    if (b.available) {
      const desc =
        b.benefitType === "FREE"
          ? "sem custo"
          : b.benefitType === "DISCOUNT_PERCENT"
            ? `${b.benefitValue ?? 0}% de desconto`
            : "com desconto";
      available.push({ procedureName: name, description: desc });
    } else if (b.blockedReason) {
      blocked.push({ procedureName: name, reason: b.blockedReason });
    }
  }

  return {
    active: true,
    companyName: program.companyName,
    totalSavedCents: totalSaved,
    usageCount: usages.length,
    usages,
    available,
    blocked,
  };
}
