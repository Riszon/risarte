"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Landmark,
  Plus,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import type { ChartAccount } from "@/lib/finance/accounts";
import {
  candidatosParaVarios,
  CONTA_DE_TRANSFERENCIA,
  contasDoValor,
  mesDaDre,
  decodeStatement,
  parseStatement,
  somaDosLancamentos,
  RECONCILIATION_STATUS_LABELS,
  suggestMatches,
  summarizeReconciliation,
  type ContaEmAberto,
  type LedgerEntry,
  type ReconciliationStatus,
} from "@/lib/finance/reconciliation";
import { FORMAS_DE_PAGAR } from "@/lib/finance/formas-de-pagar";
import {
  createEntryFromTransaction,
  setDefaultBankAccount,
  transferWithCashBox,
  deleteImport,
  ignoreTransaction,
  payPayableFromTransaction,
  reconcileMultiple,
  importStatement,
  reconcileTransaction,
  saveBankAccount,
  unreconcileTransaction,
} from "./actions";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import {
  lancamentosDaConta,
  lancamentosSemConta,
  type ContaDaUnidade,
} from "@/lib/finance/conta-do-dinheiro";
import { ListaComBusca } from "@/components/ui/lista-com-busca";

export type ImportRow = {
  id: string;
  bankAccountId: string;
  fileName: string | null;
  format: string;
  periodStart: string | null;
  periodEnd: string | null;
  insertedCount: number;
  duplicateCount: number;
  createdAt: string;
  byName: string | null;
  revertedAt: string | null;
};

export type BankAccountRow = {
  id: string;
  alias: string;
  /** AP51: a conta principal da unidade (lido à parte — nasce na 0317). */
  isDefault?: boolean;
  bankName: string | null;
  agency: string | null;
  accountNumber: string | null;
  kind: string;
  openingBalanceCents: number;
  openingDate: string;
  active: boolean;
};

export type BankTxRow = {
  id: string;
  bankAccountId: string;
  postedAt: string;
  amountCents: number;
  description: string;
  fitId: string | null;
  status: ReconciliationStatus;
  matchedEntryId: string | null;
  ignoreReason: string | null;
  matchedByName: string | null;
};

const STATUS_STYLE: Record<ReconciliationStatus, string> = {
  pendente: "border-amber-300 bg-amber-50 text-amber-800",
  conciliado: "border-emerald-300 bg-emerald-50 text-emerald-800",
  ignorado: "border-border bg-muted text-muted-foreground",
};

const ACCOUNT_KINDS = [
  { value: "corrente", label: "Conta corrente" },
  { value: "poupanca", label: "Poupança" },
  { value: "caixa", label: "Caixa (dinheiro)" },
  { value: "aplicacao", label: "Aplicação" },
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const EMPTY_ACCOUNT: BankAccountRow = {
  id: "",
  alias: "",
  bankName: null,
  agency: null,
  accountNumber: null,
  kind: "corrente",
  openingBalanceCents: 0,
  openingDate: "",
  active: true,
};

/** FIN4a — o quadro da conciliação: importar, casar, criar e ignorar. */
export function ReconciliationBoard({
  clinicId,
  accounts,
  transactions,
  imports,
  entries,
  openPayables,
  chart,
  costCenters,
  today,
  canReconcile,
}: {
  clinicId: string;
  accounts: BankAccountRow[];
  transactions: BankTxRow[];
  imports: ImportRow[];
  entries: LedgerEntry[];
  /** OC-00110: contas a pagar em aberto da unidade. */
  openPayables: ContaEmAberto[];
  chart: ChartAccount[];
  costCenters: { id: string; name: string }[];
  today: string;
  canReconcile: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [filter, setFilter] = useState<ReconciliationStatus | "todas">(
    "pendente"
  );
  const [openTx, setOpenTx] = useState<string | null>(null);

  // Diálogos
  const [editingAccount, setEditingAccount] = useState<BankAccountRow | null>(
    null
  );
  const [openingBalance, setOpeningBalance] = useState("");
  const [creatingFor, setCreatingFor] = useState<BankTxRow | null>(null);
  const [newAccountCode, setNewAccountCode] = useState("");
  const [newCostCenter, setNewCostCenter] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [ignoringFor, setIgnoringFor] = useState<BankTxRow | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");
  // OC-00108: uma linha com vários lançamentos, e a transferência.
  const [variosFor, setVariosFor] = useState<BankTxRow | null>(null);
  const [variosSel, setVariosSel] = useState<string[]>([]);
  const [transferFor, setTransferFor] = useState<BankTxRow | null>(null);
  const [transferDesc, setTransferDesc] = useState("");
  // AP51 (L4): a transferência é com o Caixa (depósito ou saque de dinheiro)?
  const [transferCaixa, setTransferCaixa] = useState(false);
  // OC-00110: a linha de saída paga uma conta a pagar.
  const [pagarFor, setPagarFor] = useState<BankTxRow | null>(null);
  const [pagarSel, setPagarSel] = useState("");
  const [pagarForma, setPagarForma] = useState<string>("pix");
  const [showImports, setShowImports] = useState(false);
  /** A trava disparou: guardamos o arquivo lido para o "importar mesmo assim". */
  const [blocked, setBlocked] = useState<{
    message: string;
    payload: Parameters<typeof importStatement>[0];
  } | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const accountTx = useMemo(
    () => transactions.filter((t) => t.bankAccountId === accountId),
    [transactions, accountId]
  );
  const accountImports = useMemo(
    () => imports.filter((i) => i.bankAccountId === accountId),
    [imports, accountId]
  );
  const shown = useMemo(
    () => accountTx.filter((t) => filter === "todas" || t.status === filter),
    [accountTx, filter]
  );

  // AP51: cada conta soma SÓ o que é dela (o sem conta é da principal). O
  // Caixa não tem extrato nem data de abertura: conta tudo o que é dele.
  const contasDaRegra = useMemo<ContaDaUnidade[]>(
    () =>
      accounts.map((a) => ({
        id: a.id,
        clinicId,
        alias: a.alias,
        kind: a.kind,
        active: a.active,
        isDefault: Boolean(a.isDefault),
      })),
    [accounts, clinicId]
  );
  const scopedEntries = useMemo(
    () =>
      account
        ? lancamentosDaConta(
            entries.map((e) => ({ ...e, bankAccountId: e.bankAccountId ?? null })),
            { id: account.id, kind: account.kind, clinicId },
            contasDaRegra
          ).filter((e) => account.kind === "caixa" || e.cashDate >= account.openingDate)
        : [],
    [entries, account, contasDaRegra, clinicId]
  );
  const semConta = useMemo(
    () =>
      lancamentosSemConta(
        entries.map((e) => ({ bankAccountId: e.bankAccountId ?? null })),
        contasDaRegra,
        clinicId
      ),
    [entries, contasDaRegra, clinicId]
  );
  const ehCaixa = account?.kind === "caixa";

  const summary = useMemo(
    () =>
      summarizeReconciliation({
        openingBalanceCents: account?.openingBalanceCents ?? 0,
        transactions: accountTx.map((t) => ({
          amountCents: t.amountCents,
          status: t.status,
        })),
        entries: scopedEntries,
      }),
    [account, accountTx, scopedEntries]
  );

  const candidatosDosVarios = useMemo(
    () => (variosFor ? candidatosParaVarios(variosFor, scopedEntries) : []),
    [variosFor, scopedEntries]
  );
  const somaDosVarios = somaDosLancamentos(
    candidatosDosVarios.filter((e) => variosSel.includes(e.id))
  );
  // O aviso contra duplicar: o que já está no sistema com o mesmo valor.
  const parecidosAoLancar = useMemo(
    () =>
      creatingFor
        ? suggestMatches(
            {
              amountCents: creatingFor.amountCents,
              postedAt: creatingFor.postedAt,
              description: creatingFor.description,
            },
            scopedEntries
          )
        : [],
    [creatingFor, scopedEntries]
  );

  const contasAoLancar = useMemo(
    () => (creatingFor ? contasDoValor(creatingFor, openPayables) : []),
    [creatingFor, openPayables]
  );
  const contasDoPagar = useMemo(
    () => (pagarFor ? contasDoValor(pagarFor, openPayables) : []),
    [pagarFor, openPayables]
  );

  const counts = {
    todas: accountTx.length,
    pendente: accountTx.filter((t) => t.status === "pendente").length,
    conciliado: accountTx.filter((t) => t.status === "conciliado").length,
    ignorado: accountTx.filter((t) => t.status === "ignorado").length,
  };

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      const parsed = parseStatement(decodeStatement(bytes));
      if (parsed.transactions.length === 0) {
        toast.error(
          parsed.errors[0] ?? "Não consegui ler nenhum lançamento deste arquivo."
        );
        return;
      }
      for (const e of parsed.errors) toast.warning(e);

      const payload = {
        bankAccountId: accountId,
        format: parsed.format,
        fileName: file.name,
        rows: parsed.transactions,
        statementAccountId: parsed.statementAccountId,
      };
      startTransition(async () => {
        const r = await importStatement(payload);
        if (r.ok) {
          toast.success(
            `${r.inserted} lançamento(s) importado(s)` +
              (r.duplicates
                ? ` · ${r.duplicates} já estavam no sistema (não duplicou).`
                : ".")
          );
          router.refresh();
        } else if (r.blocked) {
          // Erro que o usuário resolve: mostramos e deixamos ele decidir.
          setBlocked({ message: r.error ?? "", payload });
        } else toast.error(r.error ?? "Algo deu errado.");
      });
    };
    // Os BYTES, e não o texto: a codificação é escolhida pelo conteúdo
    // (`decodeStatement`) — o Inter exporta em UTF-8, outros bancos em Latin-1,
    // e ler um como o outro estraga os acentos da descrição (OC-00103).
    reader.readAsArrayBuffer(file);
  }

  function forceImport() {
    if (!blocked) return;
    startTransition(async () => {
      const r = await importStatement({ ...blocked.payload, force: true });
      if (r.ok) {
        toast.success(`${r.inserted} lançamento(s) importado(s).`);
        setBlocked(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function undoImport(importId: string) {
    startTransition(async () => {
      const r = await deleteImport({ importId });
      if (r.ok) {
        toast.success(
          r.deleted === 0
            ? "Nada a remover: todas as linhas já tinham sido conciliadas ou removidas."
            : `${r.deleted} linha(s) removida(s).`
        );
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function match(txId: string, entryId: string) {
    startTransition(async () => {
      const r = await reconcileTransaction({
        transactionId: txId,
        entryId,
      });
      if (r.ok) {
        toast.success("Conciliado.");
        setOpenTx(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function undo(txId: string) {
    startTransition(async () => {
      const r = await unreconcileTransaction({ transactionId: txId });
      if (r.ok) {
        toast.success("Conciliação desfeita.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function createEntry() {
    if (!creatingFor) return;
    const mes = mesDaDre(creatingFor.postedAt);
    startTransition(async () => {
      const r = await createEntryFromTransaction({
        transactionId: creatingFor.id,
        accountCode: newAccountCode,
        costCenterId: newCostCenter || null,
        description: newDescription,
      });
      if (r.ok) {
        toast.success(`Lançado e conciliado — entra na DRE de ${mes}.`);
        setCreatingFor(null);
        setNewAccountCode("");
        setNewCostCenter("");
        setNewDescription("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function matchMany() {
    if (!variosFor) return;
    startTransition(async () => {
      const r = await reconcileMultiple({
        transactionId: variosFor.id,
        entryIds: variosSel,
      });
      if (r.ok) {
        toast.success(`Conciliado com ${variosSel.length} lançamentos.`);
        setVariosFor(null);
        setVariosSel([]);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doTransfer() {
    if (!transferFor) return;
    startTransition(async () => {
      const r = transferCaixa
        ? await transferWithCashBox({ transactionId: transferFor.id })
        : await createEntryFromTransaction({
            transactionId: transferFor.id,
            accountCode: CONTA_DE_TRANSFERENCIA,
            costCenterId: null,
            description: transferDesc,
          });
      if (r.ok) {
        toast.success(
          transferCaixa
            ? transferFor.amountCents >= 0
              ? "Depósito lançado: entrou no banco e saiu do Caixa."
              : "Saque lançado: saiu do banco e entrou no Caixa."
            : "Lançado como transferência e conciliado."
        );
        setTransferFor(null);
        setTransferDesc("");
        setTransferCaixa(false);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function abrirPagar(linha: BankTxRow | null, contaId = "") {
    if (!linha) return;
    setPagarFor(linha);
    setPagarSel(contaId);
    setPagarForma("pix");
  }

  function payIt() {
    if (!pagarFor || !pagarSel) return;
    startTransition(async () => {
      const r = await payPayableFromTransaction({
        transactionId: pagarFor.id,
        payableId: pagarSel,
        paymentMethod: pagarForma,
      });
      if (r.ok) {
        toast.success("Conta paga e linha conciliada.");
        setPagarFor(null);
        setPagarSel("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function doIgnore() {
    if (!ignoringFor) return;
    startTransition(async () => {
      const r = await ignoreTransaction({
        transactionId: ignoringFor.id,
        reason: ignoreReason,
      });
      if (r.ok) {
        toast.success("Linha ignorada.");
        setIgnoringFor(null);
        setIgnoreReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function saveAccount() {
    if (!editingAccount) return;
    startTransition(async () => {
      const r = await saveBankAccount({
        id: editingAccount.id || null,
        clinicId,
        alias: editingAccount.alias,
        bankName: editingAccount.bankName ?? "",
        agency: editingAccount.agency ?? "",
        accountNumber: editingAccount.accountNumber ?? "",
        kind: editingAccount.kind,
        openingBalanceCents: parseBRLToCents(openingBalance) ?? 0,
        openingDate: editingAccount.openingDate || today,
        active: editingAccount.active,
      });
      // AP51 (L2): marcar a principal desmarca as outras (no banco, de uma vez).
      if (r.ok && editingAccount.isDefault && editingAccount.kind !== "caixa" && r.id) {
        const d = await setDefaultBankAccount({ accountId: r.id });
        if (!d.ok) toast.error(d.error ?? "Não foi possível marcar a conta principal.");
      }
      if (r.ok) {
        toast.success("Conta bancária salva.");
        setEditingAccount(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (accounts.length === 0) {
    return (
      <>
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhuma conta bancária cadastrada. A conciliação começa por aqui:
              o <strong>saldo de abertura</strong> é o ponto de partida contra o
              qual tudo é conferido.
            </p>
            {canReconcile && (
              <Button
                onClick={() => {
                  setEditingAccount({ ...EMPTY_ACCOUNT, openingDate: today });
                  setOpeningBalance("");
                }}
              >
                <Plus className="mr-1 size-4" />
                Cadastrar conta bancária
              </Button>
            )}
            {!canReconcile && (
              <p className="text-xs text-muted-foreground">
                Só consulta: quem cadastra a conta bancária é o Gerente da unidade, o Financeiro da Franqueadora ou o Admin Master.
              </p>
            )}
          </CardContent>
        </Card>
        {renderAccountDialog()}
      </>
    );
  }

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* Conta + importação. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.alias}
              {a.bankName ? ` · ${a.bankName}` : ""}
              {a.isDefault ? " (principal)" : ""}
              {a.active ? "" : " (inativa)"}
            </option>
          ))}
        </select>
        {canReconcile && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx,.csv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
            {/* O Caixa não tem extrato: o que se confere é a gaveta. */}
            {!ehCaixa && (
              <Button
                size="sm"
                className="h-9"
                disabled={isPending || !accountId}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1 size-4" />
                Importar extrato
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={() => {
                if (!account) return;
                setEditingAccount(account);
                setOpeningBalance(
                  (account.openingBalanceCents / 100)
                    .toFixed(2)
                    .replace(".", ",")
                );
              }}
            >
              Editar conta
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() => {
                setEditingAccount({ ...EMPTY_ACCOUNT, openingDate: today });
                setOpeningBalance("");
              }}
            >
              <Plus className="size-4" />
            </Button>
            {accountImports.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-xs"
                onClick={() => setShowImports((v) => !v)}
              >
                Importações ({accountImports.length})
              </Button>
            )}
          </>
        )}
      </div>

      {/* Histórico de importações — e o caminho de volta de quem errou a conta. */}
      {showImports && (
        <Card>
          <CardContent className="space-y-1 p-3 text-xs">
            {accountImports.map((imp) => (
              <div
                key={imp.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0",
                  imp.revertedAt && "opacity-60"
                )}
              >
                <span>
                  {new Date(imp.createdAt).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })} ·{" "}
                  {imp.fileName ?? "(sem nome)"} ·{" "}
                  {imp.format.toUpperCase()}
                  <span className="block text-[11px] text-muted-foreground">
                    {imp.insertedCount} importado(s)
                    {imp.duplicateCount > 0 &&
                      ` · ${imp.duplicateCount} já existiam`}
                    {imp.byName && ` · ${imp.byName}`}
                    {imp.revertedAt && " · desfeita"}
                  </span>
                </span>
                {canReconcile && !imp.revertedAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => undoImport(imp.id)}
                  >
                    <RotateCcw className="mr-1 size-3" />
                    Desfazer
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AP51: lançamentos com dinheiro que não caem em conta nenhuma. */}
      {semConta > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {semConta} lançamento(s) com dinheiro ainda não têm conta e não entram
          em nenhum saldo. Marque a <strong>conta principal</strong> da unidade
          (Editar conta) — eles passam a contar nela.
        </p>
      )}

      {/* O Caixa: sem extrato, o saldo é o que deve estar na gaveta. */}
      {ehCaixa && (
        <Card>
          <CardContent className="space-y-1 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              No Caixa, pelo sistema
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(summary.systemBalanceCents)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              É o dinheiro em espécie que deve estar na gaveta: o que entrou em
              dinheiro, menos o que foi pago em dinheiro e o que foi depositado
              no banco. Conte o dinheiro e compare. O depósito no banco se lança
              na conta do banco, pela linha do extrato: <strong>Transferência</strong>{" "}
              → <strong>com o Caixa</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Saldos. */}
      <div className={cn("grid gap-2 sm:grid-cols-3", ehCaixa && "hidden")}>
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Saldo pelo banco
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(summary.bankBalanceCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Saldo pelo sistema
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatBRL(summary.systemBalanceCents)}
            </p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            summary.differenceCents !== 0
              ? "border-destructive/50"
              : "border-emerald-300"
          )}
        >
          <CardContent className="p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Diferença
            </p>
            <p
              className={cn(
                "text-xl font-semibold tabular-nums",
                summary.differenceCents !== 0
                  ? "text-destructive"
                  : "text-emerald-700"
              )}
            >
              {formatBRL(summary.differenceCents)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {summary.differenceCents === 0
                ? "fechado"
                : `${summary.pendingCount} linha(s) pendente(s) · ${summary.unmatchedEntryCount} lançamento(s) sem par`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chips. */}
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["pendente", "Pendentes"],
            ["conciliado", "Conciliados"],
            ["ignorado", "Ignorados"],
            ["todas", "Todas"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              filter === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            <span className="ml-1 tabular-nums opacity-70">
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Linhas do extrato. */}
      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {accountTx.length === 0
              ? "Nenhum extrato importado nesta conta ainda."
              : "Nenhuma linha nesta situação."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {shown.map((t) => {
            const candidates =
              t.status === "pendente"
                ? suggestMatches(
                    {
                      amountCents: t.amountCents,
                      postedAt: t.postedAt,
                      description: t.description,
                    },
                    scopedEntries
                  )
                : [];
            const matched = entries.find((e) => e.id === t.matchedEntryId);
            const contas =
              t.status === "pendente" ? contasDoValor(t, openPayables) : [];
            return (
              <div
                key={t.id}
                className={cn(
                  "rounded-lg border p-2.5 text-sm",
                  t.status === "pendente" &&
      "border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/10"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t.description}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {fmtDate(t.postedAt)}
                      {t.fitId && ` · ${t.fitId}`}
                    </span>
                    {matched && (
                      <span className="block text-[11px] text-emerald-800">
                        casado com: {matched.description} ({matched.accountCode}
                        , {fmtDate(matched.cashDate)})
                        {t.matchedByName && ` · ${t.matchedByName}`}
                      </span>
                    )}
                    {t.ignoreReason && (
                      <span className="block text-[11px] text-muted-foreground">
                        Ignorada: {t.ignoreReason}
                      </span>
                    )}
                    {t.status === "pendente" && contas.length > 0 && (
                      <span className="mt-0.5 block text-[11px] text-amber-800 dark:text-amber-300">
                        Há conta a pagar em aberto deste valor — use{" "}
                        <strong>Pagar conta</strong>.
                      </span>
                    )}
                    {t.status === "pendente" && candidates.length === 0 && contas.length === 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-destructive">
                        <AlertTriangle className="size-3" />
                        Nada no sistema com este valor — provavelmente falta
                        lançar.
                      </span>
                    )}
                  </span>

                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", STATUS_STYLE[t.status])}
                  >
                    {RECONCILIATION_STATUS_LABELS[t.status]}
                  </Badge>

                  <span
                    className={cn(
                      "text-right font-medium tabular-nums",
                      t.amountCents < 0 ? "text-destructive" : "text-emerald-700"
                    )}
                  >
                    {formatBRL(t.amountCents)}
                  </span>

                  {canReconcile && (
                    <div className="flex gap-1">
                      {t.status === "pendente" && (
                        <>
                          {candidates.length > 0 && (
                            <Button
                              size="sm"
                              className="h-8 text-[11px]"
                              onClick={() =>
                                setOpenTx(openTx === t.id ? null : t.id)
                              }
                            >
                              Casar ({candidates.length})
                            </Button>
                          )}
                          {contas.length > 0 && (
                            <Button
                              size="sm"
                              className="h-8 text-[11px]"
                              title="Dar baixa numa conta a pagar em aberto deste valor e conciliar"
                              onClick={() =>
                                abrirPagar(t, contas.length === 1 ? contas[0].id : "")
                              }
                            >
                              Pagar conta ({contas.length})
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            onClick={() => {
                              setCreatingFor(t);
                              setNewDescription(t.description);
                              setNewAccountCode("");
                              setNewCostCenter("");
                            }}
                          >
                            Lançar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            title="Casar esta linha com vários lançamentos do sistema (depósito da maquininha)"
                            onClick={() => {
                              setVariosFor(t);
                              setVariosSel([]);
                            }}
                          >
                            Vários
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            title="Dinheiro entre contas próprias: aplicação, resgate, transferência"
                            onClick={() => {
                              setTransferFor(t);
                              setTransferDesc(t.description);
                            }}
                          >
                            Transferência
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            title="Ignorar esta linha"
                            onClick={() => {
                              setIgnoringFor(t);
                              setIgnoreReason("");
                            }}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </>
                      )}
                      {t.status !== "pendente" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-[11px]"
                          onClick={() => undo(t.id)}
                        >
                          <RotateCcw className="mr-1 size-3" />
                          Desfazer
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {openTx === t.id && candidates.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
                    {candidates.slice(0, 6).map((c) => (
                      <li
                        key={c.entry.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          {c.entry.description}
                          <span className="ml-1 text-muted-foreground">
                            {c.entry.accountCode} ·{" "}
                            {fmtDate(c.entry.cashDate)}
                            {c.sameDay && " · mesmo dia"}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => match(t.id, c.entry.id)}
                        >
                          <Check className="mr-1 size-3" />
                          É este
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Criar lançamento a partir da linha. */}
      <Dialog
        open={creatingFor !== null}
        onOpenChange={(o) => !o && setCreatingFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar o que faltava</DialogTitle>
          </DialogHeader>
          {creatingFor && (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg bg-muted/40 p-2 text-xs">
                {creatingFor.description} · {fmtDate(creatingFor.postedAt)} ·{" "}
                <strong>{formatBRL(creatingFor.amountCents)}</strong>
              </p>
              {/* OC-00108: AVISO CONTRA DUPLICAR. Se o sistema já tem um
                  lançamento de mesmo valor perto da data, o certo é casar com
                  ele — lançar de novo contaria o mesmo dinheiro duas vezes. */}
              {parecidosAoLancar.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <p>
                    <strong>Isto parece já estar no sistema.</strong> Se for o
                    mesmo dinheiro, concilie em vez de lançar — lançar de novo
                    contaria duas vezes.
                  </p>
                  {parecidosAoLancar.slice(0, 3).map((c) => (
                    <div key={c.entry.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {c.entry.description} · {c.entry.accountCode} · {fmtDate(c.entry.cashDate)}
                      </span>
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          const id = creatingFor.id;
                          setCreatingFor(null);
                          match(id, c.entry.id);
                        }}
                      >
                        Conciliar com este
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {/* OC-00110: a linha de saída tem conta a pagar em aberto do
                  mesmo valor. Lançar aqui contaria a despesa duas vezes (a
                  conta já está na DRE) e deixaria a conta em aberto. */}
              {contasAoLancar.length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <p>
                    <strong>Existe conta a pagar em aberto deste valor.</strong>{" "}
                    Se for ela, pague-a em vez de lançar — lançar aqui contaria a
                    despesa duas vezes e a conta continuaria em aberto.
                  </p>
                  {contasAoLancar.slice(0, 3).map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {c.supplierName ? `${c.supplierName} — ` : ""}
                        {c.description} · vence {fmtDate(c.dueDate)}
                      </span>
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          const linha = creatingFor;
                          setCreatingFor(null);
                          abrirPagar(linha, c.id);
                        }}
                      >
                        Pagar esta conta
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {creatingFor.amountCents < 0 && contasAoLancar.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  <strong>Conta de fornecedor que está em Contas a pagar?</strong>{" "}
                  Pague-a lá (com multa ou juros, se houver) e depois case esta
                  linha (<strong>Casar</strong> ou <strong>Vários</strong>) —
                  lançar aqui contaria a despesa duas vezes. Este botão é para o
                  que o sistema não sabia (tarifa do banco, uma despesa que não
                  passou por Contas a pagar).
                </p>
              )}
              {creatingFor.amountCents > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  <strong>Recebimento de paciente ou de cartão?</strong> Ele
                  nasce na baixa da parcela, em Recebíveis — aqui você só o
                  casa (<strong>Casar</strong> ou <strong>Vários</strong>).
                  Resgate ou transferência entre contas próprias:{" "}
                  <strong>Transferência</strong>. Este botão é para o que o
                  sistema não sabia (rendimento da aplicação, uma receita que
                  não passou pelos Recebíveis).
                </p>
              )}
              <label className="block">
                <Label className="text-[11px]">Conta do plano de contas</Label>
                <ListaComBusca
                  value={newAccountCode}
                  onValueChange={setNewAccountCode}
                  className="mt-0.5 h-9 w-full"
                  options={[
                    { value: "", label: "— escolha —" },
                    ...chart
                      .filter((a) =>
                        creatingFor.amountCents < 0
                          ? a.kind === "expense"
                          : a.kind === "revenue"
                      )
                      .map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })),
                  ]}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Centro de custo</Label>
                <ListaComBusca
                  value={newCostCenter}
                  onValueChange={setNewCostCenter}
                  className="mt-0.5 h-9 w-full"
                  options={[
                    { value: "", label: "— sem centro —" },
                    ...costCenters.map((c) => ({ value: c.id, label: `${c.name}` })),
                  ]}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Descrição</Label>
                <Input
                  className="h-9"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </label>
              <p className="text-[11px] text-muted-foreground">
                O lançamento nasce com a data do extrato (
                {fmtDate(creatingFor.postedAt)}) e já conciliado com esta linha.{" "}
                <strong>
                  Na DRE, entra em {mesDaDre(creatingFor.postedAt)}
                </strong>{" "}
                — o mês da linha do extrato, não o mês de hoje.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreatingFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !newAccountCode}
              onClick={createEntry}
            >
              Lançar e conciliar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OC-00110: a linha de saída paga uma conta a pagar em aberto. */}
      <Dialog
        open={pagarFor !== null}
        onOpenChange={(o) => !o && setPagarFor(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pagar conta a pagar</DialogTitle>
          </DialogHeader>
          {pagarFor && (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg bg-muted/40 p-2 text-xs">
                {pagarFor.description} · {fmtDate(pagarFor.postedAt)} ·{" "}
                <strong>{formatBRL(pagarFor.amountCents)}</strong>
              </p>
              <p className="text-[11px] text-muted-foreground">
                A conta escolhida recebe a baixa com a data do extrato (
                {fmtDate(pagarFor.postedAt)}) e esta linha fica conciliada com o
                pagamento — tudo de uma vez. A despesa já está na DRE desde que
                a conta foi lançada, no mês da competência dela: pagar não lança
                de novo.
              </p>
              {contasDoPagar.length === 0 ? (
                <p className="rounded-lg border p-3 text-xs text-muted-foreground">
                  Nenhuma conta a pagar em aberto com este valor.
                </p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs">
                  {contasDoPagar.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="conta-a-pagar"
                          checked={pagarSel === c.id}
                          onChange={() => setPagarSel(c.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {c.supplierName ? `${c.supplierName} — ` : ""}
                          {c.description}
                          <span className="ml-1 text-muted-foreground">
                            {c.accountCode} · vence {fmtDate(c.dueDate)}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatBRL(c.balanceCents)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <label className="block">
                <Label className="text-[11px]">Forma de pagamento</Label>
                <select
                  value={pagarForma}
                  onChange={(e) => setPagarForma(e.target.value)}
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {FORMAS_DE_PAGAR.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-muted-foreground">
                Só aparece conta com o saldo <strong>exato</strong> da linha.
                Pagou com multa ou juros, ou só uma parte? Pague em{" "}
                <strong>Contas a pagar</strong> (lá se informam multa e juros) e
                depois case esta linha com <strong>Vários</strong>.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPagarFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !pagarSel}
              onClick={payIt}
            >
              <Check className="mr-1 size-4" />
              Pagar e conciliar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OC-00108: uma linha com vários lançamentos (o depósito da maquininha). */}
      <Dialog
        open={variosFor !== null}
        onOpenChange={(o) => !o && setVariosFor(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Casar com vários lançamentos</DialogTitle>
          </DialogHeader>
          {variosFor && (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg bg-muted/40 p-2 text-xs">
                {variosFor.description} · {fmtDate(variosFor.postedAt)} ·{" "}
                <strong>{formatBRL(variosFor.amountCents)}</strong>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Para quando o banco junta vários lançamentos numa linha só — o
                depósito da maquininha, por exemplo, é a soma dos recebimentos
                menos as taxas. Marque os lançamentos do sistema (até 7 dias da
                data da linha) até a soma bater no centavo.
              </p>
              {candidatosDosVarios.length === 0 ? (
                <p className="rounded-lg border p-3 text-xs text-muted-foreground">
                  Nenhum lançamento do sistema sem par perto desta data.
                </p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs">
                  {candidatosDosVarios.map((e) => (
                    <li key={e.id}>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={variosSel.includes(e.id)}
                          onChange={(ev) =>
                            setVariosSel((sel) =>
                              ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id)
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {e.description}
                          <span className="ml-1 text-muted-foreground">
                            {e.accountCode} · {fmtDate(e.cashDate)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "tabular-nums",
                            e.amountCents < 0 ? "text-destructive" : "text-emerald-700"
                          )}
                        >
                          {formatBRL(e.amountCents)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p
                className={cn(
                  "rounded-lg p-2 text-xs",
                  somaDosVarios === variosFor.amountCents && variosSel.length >= 2
                    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "bg-muted/40"
                )}
              >
                Soma dos marcados: <strong>{formatBRL(somaDosVarios)}</strong> · a
                linha: <strong>{formatBRL(variosFor.amountCents)}</strong>
                {somaDosVarios !== variosFor.amountCents &&
                  ` · faltam ${formatBRL(variosFor.amountCents - somaDosVarios)}`}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setVariosFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                isPending ||
                !variosFor ||
                variosSel.length < 2 ||
                somaDosVarios !== variosFor.amountCents
              }
              onClick={matchMany}
            >
              <Check className="mr-1 size-4" />
              Conciliar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OC-00108: transferência entre contas próprias (aplicação, resgate). */}
      <Dialog
        open={transferFor !== null}
        onOpenChange={(o) => !o && setTransferFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transferência / aplicação</DialogTitle>
          </DialogHeader>
          {transferFor && (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg bg-muted/40 p-2 text-xs">
                {transferFor.description} · {fmtDate(transferFor.postedAt)} ·{" "}
                <strong>{formatBRL(transferFor.amountCents)}</strong>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Dinheiro entre contas da própria clínica — resgate ou aplicação
                de investimento, transferência de uma conta para outra.{" "}
                <strong>Não é receita nem despesa:</strong> não entra na DRE. A
                linha fica no saldo do banco e o sistema lança na conta{" "}
                {CONTA_DE_TRANSFERENCIA} (aplicações e transferências), já
                conciliada.
              </p>
              {/* AP51 (L4): com o Caixa, as DUAS pontas são lançadas. */}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={transferCaixa}
                  onChange={(e) => setTransferCaixa(e.target.checked)}
                />
                <span className="text-xs">
                  É com o <strong>Caixa</strong> (dinheiro em espécie):{" "}
                  {transferFor.amountCents >= 0
                    ? "depósito do dinheiro do caixa — entra no banco e sai do Caixa."
                    : "saque para o caixa — sai do banco e entra no Caixa."}
                </span>
              </label>
              {!transferCaixa && (
                <label className="block">
                  <Label className="text-[11px]">Descrição</Label>
                  <Input
                    className="h-9"
                    value={transferDesc}
                    onChange={(e) => setTransferDesc(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferFor(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending} onClick={doTransfer}>
              Lançar como transferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ignorar. */}
      <Dialog
        open={ignoringFor !== null}
        onOpenChange={(o) => !o && setIgnoringFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ignorar esta linha</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use só para o que não pertence a esta conciliação — uma linha
            repetida, um lançamento do banco que ele mesmo desfez. A linha sai
            desta conta: não entra no saldo pelo banco e não cria lançamento no
            sistema, então a diferença entre os dois não muda — mas o saldo pelo
            banco deixa de bater com o extrato. Para resgate, aplicação ou
            transferência entre contas próprias, use{" "}
            <strong>Transferência</strong>, que mantém o saldo certo.
          </p>
          <textarea
            value={ignoreReason}
            onChange={(e) => setIgnoreReason(e.target.value)}
            placeholder="Ex.: linha repetida no extrato"
            className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIgnoringFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !ignoreReason.trim()}
              onClick={doIgnore}
            >
              Ignorar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A trava disparou. */}
      <Dialog open={blocked !== null} onOpenChange={(o) => !o && setBlocked(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importação bloqueada</DialogTitle>
          </DialogHeader>
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{blocked?.message}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            O caminho normal é <strong>cancelar</strong> e escolher a conta
            certa. Só force se estes lançamentos forem mesmo de contas
            diferentes com valores iguais — forçar errado faz o sistema mostrar
            o dobro do dinheiro.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBlocked(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={forceImport}
            >
              Importar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderAccountDialog()}
    </div>
  );

  function renderAccountDialog() {
    return (
      <Dialog
        open={editingAccount !== null}
        onOpenChange={(o) => !o && setEditingAccount(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAccount?.id ? "Editar conta" : "Nova conta bancária"}
            </DialogTitle>
          </DialogHeader>
          {editingAccount && (
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Apelido</Label>
                <Input
                  className="h-9"
                  value={editingAccount.alias}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      alias: e.target.value,
                    })
                  }
                  placeholder="Ex.: Itaú da unidade Cambé"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Banco</Label>
                <Input
                  className="h-9"
                  value={editingAccount.bankName ?? ""}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      bankName: e.target.value,
                    })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Tipo</Label>
                <select
                  value={editingAccount.kind}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      kind: e.target.value,
                    })
                  }
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {ACCOUNT_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Agência</Label>
                <Input
                  className="h-9"
                  value={editingAccount.agency ?? ""}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      agency: e.target.value,
                    })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Conta</Label>
                <Input
                  className="h-9"
                  value={editingAccount.accountNumber ?? ""}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      accountNumber: e.target.value,
                    })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Saldo de abertura (R$)</Label>
                <Input
                  className="h-9"
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Data da abertura</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={editingAccount.openingDate || today}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      openingDate: e.target.value,
                    })
                  }
                />
              </label>
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                O saldo de abertura é o ponto de partida: sem ele a diferença
                nunca fecha em zero. Use o saldo do extrato no dia em que a
                unidade começou a lançar no sistema.
              </p>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={editingAccount.active}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      active: e.target.checked,
                    })
                  }
                />
                <span className="text-xs">Ativa</span>
              </label>
              {editingAccount.kind !== "caixa" && (
                <label className="flex items-start gap-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={Boolean(editingAccount.isDefault)}
                    onChange={(e) =>
                      setEditingAccount({
                        ...editingAccount,
                        isDefault: e.target.checked,
                      })
                    }
                  />
                  <span className="text-xs">
                    <strong>Conta principal</strong> da unidade — é a que vem
                    preenchida em cartão, Pix e boleto ao receber e ao pagar
                    (dinheiro vai para o Caixa). Só uma por unidade.
                  </span>
                </label>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingAccount(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !editingAccount?.alias.trim()}
              onClick={saveAccount}
            >
              <Landmark className="mr-1 size-4" />
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}
