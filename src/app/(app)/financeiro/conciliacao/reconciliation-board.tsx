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
  parseStatement,
  RECONCILIATION_STATUS_LABELS,
  suggestMatches,
  summarizeReconciliation,
  type LedgerEntry,
  type ReconciliationStatus,
} from "@/lib/finance/reconciliation";
import {
  createEntryFromTransaction,
  ignoreTransaction,
  importStatement,
  reconcileTransaction,
  saveBankAccount,
  unreconcileTransaction,
} from "./actions";

export type BankAccountRow = {
  id: string;
  alias: string;
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
  entries,
  chart,
  costCenters,
  today,
  canReconcile,
}: {
  clinicId: string;
  accounts: BankAccountRow[];
  transactions: BankTxRow[];
  entries: LedgerEntry[];
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

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const accountTx = useMemo(
    () => transactions.filter((t) => t.bankAccountId === accountId),
    [transactions, accountId]
  );
  const shown = useMemo(
    () => accountTx.filter((t) => filter === "todas" || t.status === filter),
    [accountTx, filter]
  );

  // Só os lançamentos a partir da abertura da conta entram na conta do saldo.
  const scopedEntries = useMemo(
    () =>
      account
        ? entries.filter((e) => e.cashDate >= account.openingDate)
        : [],
    [entries, account]
  );

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

  const counts = {
    todas: accountTx.length,
    pendente: accountTx.filter((t) => t.status === "pendente").length,
    conciliado: accountTx.filter((t) => t.status === "conciliado").length,
    ignorado: accountTx.filter((t) => t.status === "ignorado").length,
  };

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      const parsed = parseStatement(content);
      if (parsed.transactions.length === 0) {
        toast.error(
          parsed.errors[0] ?? "Não consegui ler nenhum lançamento deste arquivo."
        );
        return;
      }
      for (const e of parsed.errors) toast.warning(e);

      startTransition(async () => {
        const r = await importStatement({
          bankAccountId: accountId,
          format: parsed.format,
          fileName: file.name,
          rows: parsed.transactions,
        });
        if (r.ok) {
          toast.success(
            `${r.inserted} lançamento(s) importado(s)` +
              (r.duplicates
                ? ` · ${r.duplicates} já estavam no sistema (não duplicou).`
                : ".")
          );
          router.refresh();
        } else toast.error(r.error ?? "Algo deu errado.");
      });
    };
    // Extrato de banco brasileiro costuma vir em Latin-1; ler como UTF-8
    // estragaria os acentos da descrição.
    reader.readAsText(file, "windows-1252");
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
    startTransition(async () => {
      const r = await createEntryFromTransaction({
        transactionId: creatingFor.id,
        accountCode: newAccountCode,
        costCenterId: newCostCenter || null,
        description: newDescription,
      });
      if (r.ok) {
        toast.success("Lançamento criado e conciliado.");
        setCreatingFor(null);
        setNewAccountCode("");
        setNewCostCenter("");
        setNewDescription("");
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
            <Button
              size="sm"
              className="h-9"
              disabled={isPending || !accountId}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1 size-4" />
              Importar extrato
            </Button>
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
          </>
        )}
      </div>

      {/* Saldos. */}
      <div className="grid gap-2 sm:grid-cols-3">
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
            return (
              <div
                key={t.id}
                className={cn(
                  "rounded-lg border p-2.5 text-sm",
                  t.status === "pendente" && "border-amber-300 bg-amber-50/40"
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
                    {t.status === "pendente" && candidates.length === 0 && (
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
              <label className="block">
                <Label className="text-[11px]">Conta do plano de contas</Label>
                <select
                  value={newAccountCode}
                  onChange={(e) => setNewAccountCode(e.target.value)}
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">— escolha —</option>
                  {chart
                    .filter((a) =>
                      creatingFor.amountCents < 0
                        ? a.kind === "expense"
                        : a.kind === "revenue"
                    )
                    .map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Centro de custo</Label>
                <select
                  value={newCostCenter}
                  onChange={(e) => setNewCostCenter(e.target.value)}
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">— sem centro —</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
                O lançamento nasce com a data do extrato e já conciliado com
                esta linha.
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
            Use para o que não pertence a esta conciliação — transferência entre
            contas próprias, por exemplo. A linha sai do saldo do banco e o
            motivo fica registrado.
          </p>
          <textarea
            value={ignoreReason}
            onChange={(e) => setIgnoreReason(e.target.value)}
            placeholder="Ex.: transferência para a conta poupança da própria unidade"
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
