/**
 * AP51 — EM QUAL CONTA O DINHEIRO ENTROU OU SAIU (0317).
 *
 * Decisões do dono (22/10/2026, `docs/Financeiro/AP51-PLANO.md`):
 *   L1 — o Caixa (dinheiro em espécie) é uma conta da unidade, criada sozinha
 *        na primeira baixa em dinheiro;
 *   L2 — cartão, Pix e boleto vêm com a conta PRINCIPAL; dinheiro, com o Caixa;
 *   L3 — lançamento antigo sem conta conta como da principal.
 *
 * ⚠️ QUEM DECIDE É O BANCO. O gatilho `financial_entry_bank_account` (0317)
 * aplica as mesmas regras a todo lançamento com dinheiro. Este arquivo só
 * espelha a regra para a tela PREENCHER o campo e separar a Conciliação por
 * conta — mudou uma, muda a outra (`conta-do-dinheiro.test.ts` prende as duas).
 */

export type ContaDaUnidade = {
  id: string;
  clinicId: string;
  alias: string;
  /** corrente · poupanca · aplicacao · caixa */
  kind: string;
  active: boolean;
  isDefault: boolean;
};

/** O valor do campo quando a escolha é o dinheiro em espécie. */
export const CAIXA = "caixa";

const ehCaixa = (c: Pick<ContaDaUnidade, "kind">) => c.kind === "caixa";

/** As contas bancárias ativas da unidade (sem o Caixa), a principal primeiro. */
export function contasBancarias(contas: ContaDaUnidade[], clinicId: string): ContaDaUnidade[] {
  return contas
    .filter((c) => c.clinicId === clinicId && c.active && !ehCaixa(c))
    .sort((a, b) =>
      a.isDefault !== b.isDefault ? (a.isDefault ? -1 : 1) : a.alias.localeCompare(b.alias)
    );
}

/**
 * A principal da unidade: a marcada; sem marca, a ÚNICA conta bancária; senão
 * nenhuma (a mesma régua do `_default_bank_account`).
 */
export function contaPrincipal(contas: ContaDaUnidade[], clinicId: string): ContaDaUnidade | null {
  const bancarias = contasBancarias(contas, clinicId);
  return bancarias.find((c) => c.isDefault) ?? (bancarias.length === 1 ? bancarias[0] : null);
}

export type OpcaoDeConta = { value: string; label: string };

/**
 * As opções do campo "Entrou em" / "Saiu de". O Caixa aparece sempre (L1: ele
 * nasce na primeira baixa em dinheiro). Sem conta bancária que a pessoa
 * enxergue, a opção vazia deixa o banco escolher a principal.
 */
export function opcoesDeConta(contas: ContaDaUnidade[], clinicId: string): OpcaoDeConta[] {
  const bancarias = contasBancarias(contas, clinicId);
  const opcoes: OpcaoDeConta[] = bancarias.length
    ? bancarias.map((c) => ({
        value: c.id,
        label: c.isDefault || bancarias.length === 1 ? `${c.alias} (principal)` : c.alias,
      }))
    : [{ value: "", label: "Conta principal da unidade" }];
  opcoes.push({ value: CAIXA, label: "Caixa (dinheiro)" });
  return opcoes;
}

/** O que vem preenchido (L2): dinheiro → Caixa; o resto → a principal. */
export function contaPadrao(contas: ContaDaUnidade[], clinicId: string, metodo: string | null): string {
  if (metodo === "dinheiro") return CAIXA;
  return contaPrincipal(contas, clinicId)?.id ?? "";
}

/**
 * Os lançamentos que são DESTA conta, para a Conciliação. Lançamento sem conta
 * (antes da 0317, ou unidade sem principal) conta como da principal (L3) —
 * nunca do Caixa, e nunca de duas contas ao mesmo tempo.
 */
export function lancamentosDaConta<T extends { bankAccountId?: string | null }>(
  lancamentos: T[],
  conta: Pick<ContaDaUnidade, "id" | "kind" | "clinicId">,
  contas: ContaDaUnidade[]
): T[] {
  const principal = contaPrincipal(contas, conta.clinicId);
  const recebeOsSemConta = !ehCaixa(conta) && principal?.id === conta.id;
  return lancamentos.filter(
    (l) => l.bankAccountId === conta.id || (!l.bankAccountId && recebeOsSemConta)
  );
}

/** Quantos lançamentos com dinheiro não caem em conta nenhuma (falta a principal). */
export function lancamentosSemConta<T extends { bankAccountId?: string | null }>(
  lancamentos: T[],
  contas: ContaDaUnidade[],
  clinicId: string
): number {
  if (contaPrincipal(contas, clinicId)) return 0;
  return lancamentos.filter((l) => !l.bankAccountId).length;
}

/** Erros do banco desta parte, em português (null = não é daqui). */
export function erroDaConta(mensagem: string): string | null {
  if (mensagem.includes("BANK_ACCOUNT_INVALID"))
    return "Essa conta não é desta unidade (ou foi desativada). Escolha outra.";
  if (mensagem.includes("CASH_BOX_NOT_DEFAULT"))
    return "O Caixa (dinheiro) não pode ser a conta principal.";
  if (mensagem.includes("ALREADY_CASH_BOX"))
    return "Esta linha já é do Caixa.";
  return null;
}

/** A porta nova ainda não existe neste banco (código no ar antes da 0317)? */
export function portaAusente(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /could not find the function/i.test(error.message ?? "")
  );
}
