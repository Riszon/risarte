// FIN0 — plano de contas e centros de custo (tipos + regras puras).
// Espelha as tabelas public.chart_of_accounts e public.cost_centers.

export const ACCOUNT_KINDS = ["revenue", "expense"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  revenue: "Receita",
  expense: "Despesa",
};

export const ACCOUNT_NATURES = [
  "operational",
  "deduction",
  "direct_cost",
  "financial",
  "investment",
  "intercompany",
] as const;
export type AccountNature = (typeof ACCOUNT_NATURES)[number];

export const ACCOUNT_NATURE_LABELS: Record<AccountNature, string> = {
  operational: "Operacional",
  deduction: "Dedução da receita",
  direct_cost: "Custo direto",
  financial: "Resultado financeiro",
  investment: "Investimento / não operacional",
  intercompany: "Entre empresas (royalty/fundo)",
};

export const COST_BEHAVIORS = ["fixed", "variable", "none"] as const;
export type CostBehavior = (typeof COST_BEHAVIORS)[number];

export const COST_BEHAVIOR_LABELS: Record<CostBehavior, string> = {
  fixed: "Fixo",
  variable: "Variável",
  none: "Não se aplica",
};

export const ACCOUNT_SCOPES = ["unit", "franchisor", "both"] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

export const ACCOUNT_SCOPE_LABELS: Record<AccountScope, string> = {
  unit: "Unidade",
  franchisor: "Franqueadora",
  both: "Ambas",
};

export type ChartAccount = {
  code: string;
  name: string;
  parentCode: string | null;
  kind: AccountKind;
  nature: AccountNature;
  costBehavior: CostBehavior;
  scope: AccountScope;
  isAnalytic: boolean;
  fiscalAccountCode: string | null;
  active: boolean;
};

/** Código válido: números separados por ponto ("1", "1.1", "1.1.01"). */
export function isValidAccountCode(code: string): boolean {
  return /^\d+(\.\d+)*$/.test(code.trim());
}

/** Nível na árvore: "1" = 1, "1.1" = 2, "1.1.01" = 3. */
export function accountLevel(code: string): number {
  return code.split(".").length;
}

/** Código do pai ("1.1.01" → "1.1"); null na raiz. */
export function parentAccountCode(code: string): string | null {
  const parts = code.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

/**
 * Ordena contas pelo código de forma HIERÁRQUICA e numérica: "1.9" vem antes de
 * "1.10", e "2" vem depois de "1.9.03". Comparar como texto puro erraria os dois.
 */
export function compareAccountCodes(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

export function sortAccounts<T extends { code: string }>(accounts: T[]): T[] {
  return [...accounts].sort((a, b) => compareAccountCodes(a.code, b.code));
}

/** Contas que podem receber lançamento: analíticas e ativas, do escopo certo. */
export function postableAccounts(
  accounts: ChartAccount[],
  scope: "unit" | "franchisor"
): ChartAccount[] {
  return sortAccounts(
    accounts.filter(
      (a) =>
        a.isAnalytic && a.active && (a.scope === "both" || a.scope === scope)
    )
  );
}

// ---------------------------------------------------------------------------
// Centros de custo
// ---------------------------------------------------------------------------

export const COST_CENTER_SCOPES = ["franchisor", "network", "unit"] as const;
export type CostCenterScope = (typeof COST_CENTER_SCOPES)[number];

export const COST_CENTER_SCOPE_LABELS: Record<CostCenterScope, string> = {
  franchisor: "Franqueadora",
  network: "Padrão da rede",
  unit: "Da unidade",
};

export type CostCenter = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  scope: CostCenterScope;
  clinicId: string | null;
  active: boolean;
};

export type CostCenterNode = CostCenter & { children: CostCenterNode[] };

/** Monta a árvore de centros de custo (raízes primeiro, filhos por nome). */
export function buildCostCenterTree(centers: CostCenter[]): CostCenterNode[] {
  const byId = new Map<string, CostCenterNode>();
  for (const c of centers) byId.set(c.id, { ...c, children: [] });

  const roots: CostCenterNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: CostCenterNode[]) => {
    nodes.sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

/**
 * A unidade só cria centro como FILHO de um centro da REDE — é o que mantém o
 * consolidado comparável entre 200 unidades (a mesma trava existe no banco).
 */
export function canBeParentOfUnitCenter(parent: CostCenter | null): boolean {
  return parent?.scope === "network";
}
