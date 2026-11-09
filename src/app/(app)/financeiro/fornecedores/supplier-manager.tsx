"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, Plus, Tags } from "lucide-react";
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
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { cn } from "@/lib/utils";
import { atendeABusca } from "@/lib/busca";
import { formatBrDateTime } from "@/lib/dates";
import { formatCep, formatCnpj, formatCpf, formatPhone } from "@/lib/masks";
import {
  BANK_ACCOUNT_TYPE_OPTIONS,
  EMPTY_SUPPLIER,
  PAYMENT_METHOD_OPTIONS,
  PIX_KEY_TYPE_OPTIONS,
  SCOPE_LABELS,
  avisoDoDocumento,
  descreverAbrangencia,
  faltaNaFicha,
  opcoesDeTipo,
  tipoDePessoa,
  type SupplierForm,
  type SupplierKind,
  type SupplierScope,
} from "@/lib/fornecedores";
import { findSameDocument, saveSupplier } from "./actions";
import { SupplierHistory } from "./supplier-history";
import { KindsDialog } from "./kinds-dialog";

/** CPF ou CNPJ conforme o tamanho — fornecedor pode ser pessoa física. */
function formatDoc(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 11 ? formatCnpj(digits) : formatCpf(digits);
}

export type SupplierListRow = {
  form: SupplierForm;
  ownerClinicId: string | null;
  createdAt: string | null;
  createdByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

type ClinicOption = { id: string; name: string; isFranchisor: boolean; active: boolean };

const SELECT_CLASS =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-60";

export function SupplierManager({
  activeClinicId,
  activeClinicName,
  activeIsFranchisor,
  suppliers,
  kinds,
  clinics,
  accounts,
  canEdit,
  full,
  managedUnitIds,
}: {
  activeClinicId: string | null;
  activeClinicName: string | null;
  activeIsFranchisor: boolean;
  suppliers: SupplierListRow[];
  kinds: SupplierKind[];
  clinics: ClinicOption[];
  accounts: { code: string; name: string }[];
  canEdit: boolean;
  full: boolean;
  managedUnitIds: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<SupplierListRow | null>(null);
  const [aba, setAba] = useState<"dados" | "historico">("dados");
  const [showInactive, setShowInactive] = useState(false);
  const [busca, setBusca] = useState("");
  const [kindsOpen, setKindsOpen] = useState(false);
  const [mesmoDocumento, setMesmoDocumento] = useState<{ name: string; scope: string }[]>([]);

  const nomesDasUnidades = useMemo(
    () => new Map(clinics.map((c) => [c.id, c.name])),
    [clinics]
  );
  const rotuloDoTipo = useMemo(() => new Map(kinds.map((k) => [k.code, k.label])), [kinds]);
  // Unidades que podem ser escolhidas: a Franqueadora escolhe qualquer
  // unidade; o Gerente, só as que gerencia.
  const unidadesEscolhiveis = clinics.filter(
    (c) => !c.isFranchisor && c.active && (full || managedUnitIds.includes(c.id))
  );

  const shown = suppliers.filter(
    (s) =>
      (showInactive || s.form.active) &&
      atendeABusca(
        `${s.form.name} ${s.form.legalName} ${s.form.document} ${rotuloDoTipo.get(s.form.kind) ?? ""}`,
        busca
      )
  );

  /** Pode mexer NESTE fornecedor? O banco confere de novo. */
  function podeEditar(s: SupplierForm): boolean {
    if (!canEdit) return false;
    if (full) return true;
    if (!s.id) return true;
    return s.scope === "unidades" && s.clinicIds.every((id) => managedUnitIds.includes(id));
  }

  function novo() {
    const form: SupplierForm = { ...EMPTY_SUPPLIER, kind: "" };
    if (full && activeIsFranchisor) {
      form.scope = "franqueadora";
    } else if (activeClinicId && (full || managedUnitIds.includes(activeClinicId))) {
      form.clinicIds = [activeClinicId];
    }
    setMesmoDocumento([]);
    setAba("dados");
    setEditing({ form, ownerClinicId: activeClinicId, createdAt: null, createdByName: null, updatedAt: null, updatedByName: null });
  }

  function abrir(s: SupplierListRow) {
    setMesmoDocumento([]);
    setAba("dados");
    setEditing(s);
  }

  function muda(patch: Partial<SupplierForm>) {
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  }

  function conferirDocumento() {
    if (!editing) return;
    const doc = editing.form.document;
    const id = editing.form.id || null;
    startTransition(async () => {
      const iguais = await findSameDocument(doc, id);
      setMesmoDocumento(iguais.map((i) => ({ name: i.name, scope: i.scope })));
    });
  }

  function save() {
    if (!editing) return;
    const falta = faltaNaFicha(editing.form);
    if (falta) {
      toast.error(falta);
      return;
    }
    startTransition(async () => {
      const r = await saveSupplier(editing.form, editing.ownerClinicId ?? activeClinicId);
      if (r.ok) {
        toast.success("Fornecedor salvo.");
        setEditing(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const f = editing?.form ?? null;
  const editavel = f ? podeEditar(f) : false;
  const tiposParaEscolher = f ? opcoesDeTipo(kinds, f.kind) : [];
  const aviso = f ? avisoDoDocumento(f.document) : null;
  const pessoa = f ? tipoDePessoa(f.document) : null;

  const campo = (
    rotulo: string,
    valor: string,
    onChange: (v: string) => void,
    opts: { span?: boolean; mask?: (v: string) => string; placeholder?: string; inputMode?: "numeric" | "email" | "tel" | "url" } = {}
  ) => (
    <label className={cn("block", opts.span && "sm:col-span-2")}>
      <Label className="text-[11px]">{rotulo}</Label>
      <Input
        className="h-9"
        disabled={!editavel}
        value={opts.mask ? opts.mask(valor) : valor}
        placeholder={opts.placeholder}
        inputMode={opts.inputMode}
        onChange={(e) => onChange(opts.mask ? opts.mask(e.target.value) : e.target.value)}
      />
    </label>
  );

  const secao = (titulo: string) => (
    <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
      {titulo}
    </p>
  );

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="h-9 w-56"
            placeholder="Buscar por nome, CNPJ ou tipo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Mostrar inativos
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {full && (
            <Button size="sm" variant="outline" onClick={() => setKindsOpen(true)}>
              <Tags className="mr-1 size-4" />
              Tipos
            </Button>
          )}
          {canEdit ? (
            <Button size="sm" onClick={novo}>
              <Plus className="mr-1 size-4" />
              Novo fornecedor
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Só consulta: quem cadastra fornecedor é o Gerente da unidade, o Financeiro da Franqueadora ou o Admin Master.
            </span>
          )}
        </div>
      </div>

      {activeClinicName && (
        <p className="text-xs text-muted-foreground">
          Fornecedores que valem em <strong>{activeClinicName}</strong>.
        </p>
      )}

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum fornecedor {busca ? "encontrado" : "cadastrado"}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {shown.map((s) => (
            <button
              type="button"
              key={s.form.id}
              onClick={() => abrir(s)}
              className={cn(
                "flex w-full flex-wrap items-center gap-2 rounded-lg border p-2.5 text-left text-sm hover:bg-muted/50",
                !s.form.active && "opacity-60"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.form.name}</span>
                {s.form.legalName && s.form.legalName !== s.form.name && (
                  <span className="ml-2 text-xs text-muted-foreground">{s.form.legalName}</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {rotuloDoTipo.get(s.form.kind) ?? s.form.kind}
                  {s.form.document && ` · ${formatDoc(s.form.document)}`}
                  {s.form.phone && ` · ${formatPhone(s.form.phone)}`}
                </span>
              </span>
              <Badge variant="outline" className="text-[10px]">
                {descreverAbrangencia(s.form.scope, s.form.clinicIds, nomesDasUnidades)}
              </Badge>
              {!s.form.active && (
                <Badge variant="outline" className="text-[10px]">
                  Inativo
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {f?.id ? (editavel ? "Editar fornecedor" : "Fornecedor") : "Novo fornecedor"}
            </DialogTitle>
          </DialogHeader>

          {editing && f && (
            <>
              {f.id && (
                <div className="flex gap-1 border-b text-sm">
                  {(["dados", "historico"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAba(a)}
                      className={cn(
                        "-mb-px border-b-2 px-3 py-1.5",
                        aba === a ? "border-primary font-medium" : "border-transparent text-muted-foreground"
                      )}
                    >
                      {a === "dados" ? "Dados" : (
                        <span className="inline-flex items-center gap-1">
                          <History className="size-3.5" /> Histórico
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {f.id && (
                <p className="text-xs text-muted-foreground">
                  Cadastrado
                  {editing.createdAt && ` em ${formatBrDateTime(editing.createdAt)}`}
                  {editing.createdByName && ` por ${editing.createdByName}`}
                  {editing.updatedAt && editing.updatedAt !== editing.createdAt && (
                    <>
                      {" · "}última alteração em {formatBrDateTime(editing.updatedAt)}
                      {editing.updatedByName && ` por ${editing.updatedByName}`}
                    </>
                  )}
                </p>
              )}

              {aba === "historico" && f.id ? (
                <SupplierHistory
                  supplierId={f.id}
                  nomesDasUnidades={nomesDasUnidades}
                  rotuloDoTipo={rotuloDoTipo}
                  contas={new Map(accounts.map((a) => [a.code, `${a.code} · ${a.name}`]))}
                />
              ) : (
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  {!editavel && f.id && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-900 sm:col-span-2 dark:bg-amber-950/30 dark:text-amber-200">
                      {canEdit
                        ? "Este fornecedor vale também fora das suas unidades: quem altera é o Financeiro da Franqueadora."
                        : "Só consulta."}
                    </p>
                  )}

                  {secao("Identificação")}
                  {campo("Nome (como aparece nas listas) *", f.name, (v) => muda({ name: v }), { span: true })}
                  {campo("Razão social", f.legalName, (v) => muda({ legalName: v }), { span: true })}
                  <label className="block">
                    <Label className="text-[11px]">
                      CNPJ / CPF *{pessoa && <span className="ml-1 text-muted-foreground">({pessoa})</span>}
                    </Label>
                    <Input
                      className="h-9"
                      disabled={!editavel}
                      inputMode="numeric"
                      value={formatDoc(f.document)}
                      onChange={(e) => muda({ document: e.target.value.replace(/\D/g, "").slice(0, 14) })}
                      onBlur={conferirDocumento}
                    />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Tipo *</Label>
                    <select
                      disabled={!editavel}
                      value={f.kind}
                      onChange={(e) => muda({ kind: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      <option value="">— escolha —</option>
                      {tiposParaEscolher.map((k) => (
                        <option key={k.code} value={k.code}>
                          {k.label}
                          {!k.active ? " (desativado)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {aviso && (
                    <p className="text-xs text-amber-700 sm:col-span-2 dark:text-amber-300">{aviso}</p>
                  )}
                  {mesmoDocumento.length > 0 && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-900 sm:col-span-2 dark:bg-amber-950/30 dark:text-amber-200">
                      Já existe fornecedor com este documento:{" "}
                      {mesmoDocumento
                        .map((m) => `${m.name} (${SCOPE_LABELS[m.scope as SupplierScope] ?? m.scope})`)
                        .join("; ")}
                      . Antes de cadastrar outro, veja se não basta ampliar a abrangência do que existe.
                    </p>
                  )}
                  {campo("Inscrição estadual", f.stateRegistration, (v) => muda({ stateRegistration: v }))}
                  {campo("Inscrição municipal", f.municipalRegistration, (v) => muda({ municipalRegistration: v }))}

                  {secao("Onde vale *")}
                  <div className="space-y-1.5 sm:col-span-2">
                    {(Object.keys(SCOPE_LABELS) as SupplierScope[])
                      .filter((sc) => full || sc === "unidades" || sc === f.scope)
                      .map((sc) => (
                        <label key={sc} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            className="accent-primary"
                            disabled={!editavel || (!full && sc !== "unidades")}
                            checked={f.scope === sc}
                            onChange={() => muda({ scope: sc })}
                          />
                          {SCOPE_LABELS[sc]}
                        </label>
                      ))}
                    {f.scope === "unidades" && (
                      <div className="ml-6 grid gap-1 sm:grid-cols-2">
                        {unidadesEscolhiveis.length === 0 && (
                          <span className="text-xs text-muted-foreground">Nenhuma unidade disponível.</span>
                        )}
                        {/* Unidades já marcadas que a pessoa não pode escolher aparecem, travadas. */}
                        {[
                          ...unidadesEscolhiveis,
                          ...clinics.filter(
                            (c) => f.clinicIds.includes(c.id) && !unidadesEscolhiveis.some((u) => u.id === c.id)
                          ),
                        ].map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              className="size-3.5 accent-primary"
                              disabled={!editavel || !unidadesEscolhiveis.some((u) => u.id === c.id)}
                              checked={f.clinicIds.includes(c.id)}
                              onChange={(e) =>
                                muda({
                                  clinicIds: e.target.checked
                                    ? [...f.clinicIds, c.id]
                                    : f.clinicIds.filter((id) => id !== c.id),
                                })
                              }
                            />
                            {c.name}
                          </label>
                        ))}
                      </div>
                    )}
                    {!full && (
                      <p className="text-[11px] text-muted-foreground">
                        Fornecedor da rede toda ou só da Franqueadora é cadastrado pelo Financeiro da Franqueadora.
                      </p>
                    )}
                  </div>

                  {secao("Contato")}
                  {campo("Pessoa de contato", f.contactName, (v) => muda({ contactName: v }))}
                  {campo("Telefone", f.phone, (v) => muda({ phone: v.replace(/\D/g, "") }), { mask: formatPhone, inputMode: "tel" })}
                  {campo("WhatsApp", f.whatsapp, (v) => muda({ whatsapp: v.replace(/\D/g, "") }), { mask: formatPhone, inputMode: "tel" })}
                  {campo("E-mail", f.email, (v) => muda({ email: v }), { inputMode: "email" })}
                  {campo("E-mail financeiro (notas e boletos)", f.financeEmail, (v) => muda({ financeEmail: v }), { inputMode: "email" })}
                  {campo("Site", f.website, (v) => muda({ website: v }), { inputMode: "url" })}

                  {secao("Endereço")}
                  {campo("CEP", f.addressZip, (v) => muda({ addressZip: v.replace(/\D/g, "") }), { mask: formatCep, inputMode: "numeric" })}
                  {campo("Rua / avenida", f.addressStreet, (v) => muda({ addressStreet: v }))}
                  {campo("Número", f.addressNumber, (v) => muda({ addressNumber: v }))}
                  {campo("Complemento", f.addressComplement, (v) => muda({ addressComplement: v }))}
                  {campo("Bairro", f.addressDistrict, (v) => muda({ addressDistrict: v }))}
                  {campo("Cidade", f.addressCity, (v) => muda({ addressCity: v }))}
                  {campo("UF", f.addressState, (v) => muda({ addressState: v.toUpperCase().slice(0, 2) }))}

                  {secao("Pagamento")}
                  <label className="block">
                    <Label className="text-[11px]">Forma de pagamento padrão</Label>
                    <select
                      disabled={!editavel}
                      value={f.defaultPaymentMethod}
                      onChange={(e) => muda({ defaultPaymentMethod: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      <option value="">—</option>
                      {PAYMENT_METHOD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {campo("Prazo de pagamento (dias)", f.paymentTermsDays, (v) => muda({ paymentTermsDays: v.replace(/\D/g, "").slice(0, 3) }), { inputMode: "numeric", placeholder: "Ex.: 30" })}
                  <label className="block sm:col-span-2">
                    <Label className="text-[11px]">Conta padrão do plano de contas (sugerida em Contas a pagar)</Label>
                    <ListaComBusca
                      value={f.defaultAccountCode}
                      onValueChange={(v) => muda({ defaultAccountCode: v })}
                      disabled={!editavel}
                      className="mt-0.5 h-9 w-full"
                      options={[
                        { value: "", label: "— nenhuma —" },
                        ...accounts.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })),
                      ]}
                    />
                  </label>
                  {campo("Banco", f.bankName, (v) => muda({ bankName: v }))}
                  <label className="block">
                    <Label className="text-[11px]">Tipo de conta</Label>
                    <select
                      disabled={!editavel}
                      value={f.bankAccountType}
                      onChange={(e) => muda({ bankAccountType: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      <option value="">—</option>
                      {BANK_ACCOUNT_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {campo("Agência", f.bankBranch, (v) => muda({ bankBranch: v }))}
                  {campo("Conta", f.bankAccount, (v) => muda({ bankAccount: v }))}
                  {campo("Titular da conta", f.accountHolder, (v) => muda({ accountHolder: v }))}
                  {campo("CPF / CNPJ do titular", f.accountHolderDocument, (v) => muda({ accountHolderDocument: v.replace(/\D/g, "").slice(0, 14) }), { mask: formatDoc, inputMode: "numeric" })}
                  <label className="block">
                    <Label className="text-[11px]">Tipo de chave PIX</Label>
                    <select
                      disabled={!editavel}
                      value={f.pixKeyType}
                      onChange={(e) => muda({ pixKeyType: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      <option value="">—</option>
                      {PIX_KEY_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {campo("Chave PIX", f.pixKey, (v) => muda({ pixKey: v }))}
                  {campo("Outras condições de pagamento", f.paymentNotes, (v) => muda({ paymentNotes: v }), { span: true })}

                  {secao("Observações")}
                  <label className="block sm:col-span-2">
                    <textarea
                      disabled={!editavel}
                      className="min-h-20 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                      value={f.notes}
                      onChange={(e) => muda({ notes: e.target.value })}
                    />
                  </label>
                  <label className="flex items-center gap-2 sm:col-span-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      disabled={!editavel}
                      checked={f.active}
                      onChange={(e) => muda({ active: e.target.checked })}
                    />
                    <span className="text-xs">Ativo</span>
                  </label>
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">* obrigatório</p>
                </div>
              )}
            </>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              {editavel && aba === "dados" ? "Cancelar" : "Fechar"}
            </Button>
            {editavel && aba === "dados" && (
              <Button disabled={isPending} onClick={save}>
                Salvar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {full && <KindsDialog open={kindsOpen} onOpenChange={setKindsOpen} kinds={kinds} />}
    </div>
  );
}
