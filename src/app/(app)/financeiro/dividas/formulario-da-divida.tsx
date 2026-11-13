"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { cn } from "@/lib/utils";
import { formatCnpj, isValidCnpj } from "@/lib/masks";
import { formatIsoDateBr } from "@/lib/dates";
import { EMPTY_SUPPLIER } from "@/lib/fornecedores";
import {
  DEBT_TYPES,
  DEBT_TYPE_LABELS,
  EMPTY_DEBT,
  ORIGINS,
  ORIGIN_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_REASONS,
  PRIORITY_REASON_LABELS,
  campoDeCentavos,
  faltaNoCadastro,
  origemPedeJustificativa,
  origemSugerida,
  type DebtForm,
  type DebtOrigin,
  type DebtType,
  type Priority,
} from "@/lib/finance/dividas";
import { saveSupplier } from "../fornecedores/actions";
import { criarEtiqueta, salvarDivida, salvarGrupo } from "./actions";
import type { BaseDasDividas, Divida } from "./dados";

export const SELECT_CLASS =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-60";

/** A dívida gravada → o formulário. */
export function formularioDaDivida(d: Divida): DebtForm {
  return {
    id: d.id,
    clinicId: d.clinicId,
    supplierId: d.supplierId,
    groupId: d.groupId ?? "",
    collectionContactId: d.collectionContactId ?? "",
    debtType: d.debtType,
    contractNumber: d.contractNumber ?? "",
    installmentLabel: d.installmentLabel ?? "",
    description: d.description ?? "",
    bundledCount: String(d.bundledCount),
    needsSplit: d.needsSplit,
    hasGuarantor: d.hasGuarantor,
    guarantorName: d.guarantorName ?? "",
    realGuarantee: d.realGuarantee ?? "",
    receivablesAssignment: d.receivablesAssignment,
    guaranteeNotes: d.guaranteeNotes ?? "",
    categoryId: d.categoryId ?? "",
    subcategoryId: d.subcategoryId ?? "",
    natureCode: d.natureCode ?? "",
    accountCode: d.accountCode ?? "",
    taxActiveDebt: d.taxActiveDebt,
    original: campoDeCentavos(d.originalCents),
    updated: campoDeCentavos(d.updatedCents),
    updatedRefDate: d.updatedRefDate ?? "",
    interest: campoDeCentavos(d.interestCents),
    fine: campoDeCentavos(d.fineCents),
    charges: campoDeCentavos(d.chargesCents),
    contractRatePercent: d.contractRatePercent === null ? "" : String(d.contractRatePercent).replace(".", ","),
    accrualMonth: d.accrualMonth ? d.accrualMonth.slice(0, 7) : "",
    issueDate: d.issueDate ?? "",
    dueDate: d.dueDate,
    origin: d.origin,
    originOverrideReason: d.originOverrideReason ?? "",
    priority: d.priority ?? "",
    priorityReasons: d.priorityReasons,
    ownerUserId: d.ownerUserId ?? "",
    nextAction: d.nextAction ?? "",
    nextActionOn: d.nextActionOn ?? "",
    notes: d.notes ?? "",
    tagIds: d.tagIds,
  };
}

const MOEDA = (v: string) => v.replace(/[^\d.,]/g, "");

/**
 * Cadastro e edição da dívida (0404). O banco confere tudo de novo
 * (`debt_save`); aqui é para avisar antes.
 */
export function FormularioDaDivida({
  base,
  inicial,
  aberto,
  onFechar,
}: {
  base: BaseDasDividas;
  inicial: DebtForm | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [f, setF] = useState<DebtForm>(inicial ?? EMPTY_DEBT);
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [novoCredor, setNovoCredor] = useState<{ nome: string; cnpj: string; tipo: string } | null>(null);
  const [novoGrupo, setNovoGrupo] = useState<string | null>(null);
  const [etiquetas, setEtiquetas] = useState(base.etiquetas);
  const [credores, setCredores] = useState(base.credores);
  const [grupos, setGrupos] = useState(base.grupos);

  const muda = (p: Partial<DebtForm>) => setF((x) => ({ ...x, ...p }));

  const devedor = base.devedores.find((d) => d.id === f.clinicId) ?? null;
  const sugerida = origemSugerida({
    goLiveOn: devedor?.implantacao ?? null,
    issueDate: f.issueDate || null,
    accrualMonth: f.accrualMonth || null,
  });
  const pedeJustificativa = origemPedeJustificativa(f.origin, sugerida);

  const categoriasRaiz = base.categorias.filter((c) => c.parentId === null && (c.ativa || c.id === f.categoryId));
  const subcategorias = base.categorias.filter(
    (c) => c.parentId === f.categoryId && f.categoryId !== "" && (c.ativa || c.id === f.subcategoryId)
  );
  const naturezas = base.naturezas.filter((n) => n.ativa || n.code === f.natureCode);
  const contatos = base.contatos.filter((c) => c.supplierId === f.supplierId && (c.active || c.id === f.collectionContactId));
  const gruposPossiveis = grupos.filter((g) => g.clinicId === f.clinicId && g.supplierId === f.supplierId);
  const categoria = base.categorias.find((c) => c.id === f.categoryId) ?? null;
  const contaHerdada = f.origin === "A" ? categoria?.contaAbertura : f.origin === "B" ? categoria?.contaDespesa : null;
  const nomeDaConta = useMemo(() => new Map(base.contas.map((a) => [a.code, `${a.code} · ${a.name}`])), [base.contas]);

  const escolherCategoria = (id: string) => {
    const c = base.categorias.find((x) => x.id === id);
    muda({ categoryId: id, subcategoryId: "", natureCode: c?.natureza ?? f.natureCode });
  };

  const salvar = () => {
    const falta = faltaNoCadastro(f, sugerida);
    if (falta) {
      toast.error(falta);
      return;
    }
    startTransition(async () => {
      const r = await salvarDivida(f, sugerida);
      if (r.ok) {
        toast.success(f.id ? "Dívida atualizada." : "Dívida cadastrada.");
        onFechar();
        if (!f.id && r.id) router.push(`/financeiro/dividas/${r.id}`);
        else router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  };

  const adicionarEtiqueta = () => {
    const nome = novaEtiqueta.trim();
    if (!nome) return;
    startTransition(async () => {
      const r = await criarEtiqueta(nome);
      if (r.ok && r.id) {
        if (!etiquetas.some((t) => t.id === r.id)) setEtiquetas((l) => [...l, { id: r.id!, nome, cor: null, ativa: true }]);
        muda({ tagIds: [...new Set([...f.tagIds, r.id])] });
        setNovaEtiqueta("");
      } else toast.error(r.error ?? "Não foi possível criar a etiqueta.");
    });
  };

  const criarCredor = () => {
    if (!novoCredor) return;
    const doc = novoCredor.cnpj.replace(/\D/g, "");
    if (!novoCredor.nome.trim()) return toast.error("Informe o nome do credor.");
    if (doc.length !== 14 || !isValidCnpj(doc)) return toast.error("CNPJ inválido (confira o dígito verificador).");
    if (!novoCredor.tipo) return toast.error("Escolha o tipo do credor.");
    // O credor é um fornecedor (D4). Vale só onde está a dívida: na
    // franqueadora, "só a Franqueadora"; na unidade, aquela unidade.
    const scope = devedor?.franqueadora ? "franqueadora" : "unidades";
    startTransition(async () => {
      const r = await saveSupplier(
        {
          ...EMPTY_SUPPLIER,
          name: novoCredor.nome.trim(),
          legalName: novoCredor.nome.trim(),
          document: doc,
          kind: novoCredor.tipo,
          scope,
          clinicIds: scope === "unidades" && f.clinicId ? [f.clinicId] : [],
          active: true,
        },
        f.clinicId || null
      );
      if (r.ok && r.id) {
        setCredores((l) => [...l, { id: r.id!, nome: novoCredor.nome.trim(), razaoSocial: novoCredor.nome.trim(), documento: doc, tipo: novoCredor.tipo, ativo: true }]);
        muda({ supplierId: r.id, groupId: "", collectionContactId: "" });
        setNovoCredor(null);
        toast.success("Credor cadastrado em Fornecedores.");
      } else toast.error(r.error ?? "Não foi possível cadastrar o credor.");
    });
  };

  const criarGrupo = () => {
    if (!novoGrupo?.trim()) return;
    startTransition(async () => {
      const r = await salvarGrupo({
        id: null,
        clinic_id: f.clinicId,
        supplier_id: f.supplierId,
        label: novoGrupo.trim(),
        contract_number: f.contractNumber,
        notes: "",
      });
      if (r.ok && r.id) {
        setGrupos((l) => [...l, { id: r.id!, code: "novo", clinicId: f.clinicId, supplierId: f.supplierId, label: novoGrupo.trim(), contractNumber: f.contractNumber || null }]);
        muda({ groupId: r.id });
        setNovoGrupo(null);
      } else toast.error(r.error ?? "Não foi possível criar o grupo.");
    });
  };

  const campo = (
    rotulo: string,
    valor: string,
    onChange: (v: string) => void,
    opts: { span?: boolean; type?: string; placeholder?: string; inputMode?: "numeric" | "decimal" } = {}
  ) => (
    <label className={cn("block", opts.span && "sm:col-span-2")}>
      <Label className="text-[11px]">{rotulo}</Label>
      <Input
        className="h-9"
        type={opts.type}
        value={valor}
        placeholder={opts.placeholder}
        inputMode={opts.inputMode}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
  const secao = (titulo: string) => (
    <p className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">{titulo}</p>
  );
  const marca = (rotulo: string, valor: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="accent-primary" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar dívida" : "Nova dívida"}</DialogTitle>
        </DialogHeader>

        <div className={cn("grid gap-2 text-sm sm:grid-cols-2", isPending && "opacity-70")}>
          {secao("Devedor e credor")}
          <label className="block">
            <Label className="text-[11px]">Devedor (CNPJ que deve) *</Label>
            <select className={SELECT_CLASS} value={f.clinicId} onChange={(e) => muda({ clinicId: e.target.value, groupId: "" })}>
              <option value="">— escolha —</option>
              {base.devedores.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                  {d.franqueadora ? " (franqueadora)" : ""}
                </option>
              ))}
            </select>
            {devedor && (
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {devedor.razaoSocial ?? "Sem razão social cadastrada"} · {devedor.cnpj ? formatCnpj(devedor.cnpj) : "sem CNPJ cadastrado"}
              </span>
            )}
          </label>
          <label className="block">
            <Label className="text-[11px]">Credor *</Label>
            <ListaComBusca
              value={f.supplierId}
              onValueChange={(v) => muda({ supplierId: v, groupId: "", collectionContactId: "" })}
              className="mt-0.5 h-9 w-full"
              options={[
                { value: "", label: "— escolha —" },
                ...credores
                  .filter((c) => c.ativo || c.id === f.supplierId)
                  .map((c) => ({ value: c.id, label: c.documento && c.documento.length === 14 ? `${c.nome} · ${formatCnpj(c.documento)}` : c.nome })),
              ]}
            />
            {!novoCredor ? (
              <button type="button" className="mt-0.5 text-[11px] text-primary underline" onClick={() => setNovoCredor({ nome: "", cnpj: "", tipo: "" })}>
                Credor não está na lista? Cadastrar
              </button>
            ) : null}
          </label>
          {novoCredor && (
            <div className="grid gap-2 rounded-md border bg-muted/30 p-2 sm:col-span-2 sm:grid-cols-3">
              <p className="text-xs text-muted-foreground sm:col-span-3">
                O credor entra no cadastro de Fornecedores (um cadastro só). Banco, telefone e endereço se completam depois, em Financeiro → Cadastros → Fornecedores.
              </p>
              <label className="block">
                <Label className="text-[11px]">Nome *</Label>
                <Input className="h-9" value={novoCredor.nome} onChange={(e) => setNovoCredor({ ...novoCredor, nome: e.target.value })} />
              </label>
              <label className="block">
                <Label className="text-[11px]">CNPJ *</Label>
                <Input
                  className="h-9"
                  inputMode="numeric"
                  value={formatCnpj(novoCredor.cnpj)}
                  onChange={(e) => setNovoCredor({ ...novoCredor, cnpj: e.target.value.replace(/\D/g, "").slice(0, 14) })}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Tipo *</Label>
                <select className={SELECT_CLASS} value={novoCredor.tipo} onChange={(e) => setNovoCredor({ ...novoCredor, tipo: e.target.value })}>
                  <option value="">—</option>
                  {base.tiposDeCredor.filter((k) => k.active).map((k) => (
                    <option key={k.code} value={k.code}>{k.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 sm:col-span-3">
                <Button size="sm" type="button" onClick={criarCredor} disabled={isPending || !f.clinicId}>
                  Cadastrar credor
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setNovoCredor(null)}>
                  Cancelar
                </Button>
                {!f.clinicId && <span className="self-center text-[11px] text-muted-foreground">Escolha o devedor antes.</span>}
              </div>
            </div>
          )}
          <label className="block">
            <Label className="text-[11px]">Contato de cobrança (assessoria / atendente)</Label>
            <select className={SELECT_CLASS} value={f.collectionContactId} disabled={!f.supplierId} onChange={(e) => muda({ collectionContactId: e.target.value })}>
              <option value="">—</option>
              {contatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.organization, c.personName].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">Os contatos se cadastram na aba Credores.</span>
          </label>
          <label className="block">
            <Label className="text-[11px]">Grupo (mesmo contrato ou pedido)</Label>
            <select
              className={SELECT_CLASS}
              value={f.groupId}
              disabled={!f.clinicId || !f.supplierId}
              onChange={(e) => (e.target.value === "__novo" ? setNovoGrupo("") : muda({ groupId: e.target.value }))}
            >
              <option value="">— sem grupo —</option>
              {gruposPossiveis.map((g) => (
                <option key={g.id} value={g.id}>{g.code} · {g.label}</option>
              ))}
              <option value="__novo">+ Novo grupo…</option>
            </select>
          </label>
          {novoGrupo !== null && (
            <div className="flex items-end gap-2 sm:col-span-2">
              <label className="block flex-1">
                <Label className="text-[11px]">Nome do grupo</Label>
                <Input className="h-9" value={novoGrupo} placeholder="Ex.: Compra de materiais março/2025" onChange={(e) => setNovoGrupo(e.target.value)} />
              </label>
              <Button size="sm" type="button" onClick={criarGrupo} disabled={isPending}>Criar grupo</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setNovoGrupo(null)}>Cancelar</Button>
            </div>
          )}

          {secao("Identificação")}
          <label className="block">
            <Label className="text-[11px]">Tipo da dívida</Label>
            <select className={SELECT_CLASS} value={f.debtType} onChange={(e) => muda({ debtType: e.target.value as DebtType })}>
              {DEBT_TYPES.map((t) => (
                <option key={t} value={t}>{DEBT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          {campo("Nº do contrato / título / nota", f.contractNumber, (v) => muda({ contractNumber: v }))}
          {campo("Parcela (ex.: R04 de 11)", f.installmentLabel, (v) => muda({ installmentLabel: v }))}
          <div className="grid grid-cols-2 gap-2">
            {campo("Dívidas reunidas nesta linha", f.bundledCount, (v) => muda({ bundledCount: v.replace(/\D/g, "").slice(0, 4) }), { inputMode: "numeric" })}
            <div className="flex items-end pb-2">{marca("Desdobrar depois", f.needsSplit, (v) => muda({ needsSplit: v }))}</div>
          </div>
          {campo("Descrição", f.description, (v) => muda({ description: v }), { span: true })}

          {secao("Categorização")}
          <label className="block">
            <Label className="text-[11px]">Categoria</Label>
            <select className={SELECT_CLASS} value={f.categoryId} onChange={(e) => escolherCategoria(e.target.value)}>
              <option value="">—</option>
              {categoriasRaiz.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.ativa ? "" : " (desativada)"}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label className="text-[11px]">Subcategoria</Label>
            <select className={SELECT_CLASS} value={f.subcategoryId} disabled={subcategorias.length === 0} onChange={(e) => muda({ subcategoryId: e.target.value })}>
              <option value="">—</option>
              {subcategorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.ativa ? "" : " (desativada)"}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label className="text-[11px]">Natureza</Label>
            <select className={SELECT_CLASS} value={f.natureCode} onChange={(e) => muda({ natureCode: e.target.value })}>
              <option value="">—</option>
              {naturezas.map((n) => (
                <option key={n.code} value={n.code}>{n.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label className="text-[11px]">Conta do plano de contas (vazio = a da categoria)</Label>
            <ListaComBusca
              value={f.accountCode}
              onValueChange={(v) => muda({ accountCode: v })}
              className="mt-0.5 h-9 w-full"
              options={[
                { value: "", label: contaHerdada ? `— da categoria: ${nomeDaConta.get(contaHerdada) ?? contaHerdada} —` : "— a da categoria —" },
                ...base.contas.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })),
              ]}
            />
          </label>
          <div className="sm:col-span-2">{marca("Tributo inscrito em dívida ativa", f.taxActiveDebt, (v) => muda({ taxActiveDebt: v }))}</div>
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Etiquetas</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {etiquetas
                .filter((t) => t.ativa || f.tagIds.includes(t.id))
                .map((t) => {
                  const on = f.tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => muda({ tagIds: on ? f.tagIds.filter((x) => x !== t.id) : [...f.tagIds, t.id] })}
                      className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground")}
                    >
                      {t.nome}
                    </button>
                  );
                })}
              <span className="inline-flex items-center gap-1">
                <Input
                  className="h-7 w-44 text-xs"
                  placeholder="Nova etiqueta"
                  value={novaEtiqueta}
                  onChange={(e) => setNovaEtiqueta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarEtiqueta();
                    }
                  }}
                />
                <Button size="sm" type="button" variant="outline" className="h-7 px-2" onClick={adicionarEtiqueta} disabled={isPending}>
                  <Plus className="size-3.5" />
                </Button>
              </span>
            </div>
          </div>

          {secao("Valores")}
          {campo("Valor original (R$)", f.original, (v) => muda({ original: MOEDA(v) }), { inputMode: "decimal", placeholder: "1.234,56" })}
          <div className="grid grid-cols-2 gap-2">
            {campo("Valor atualizado (R$)", f.updated, (v) => muda({ updated: MOEDA(v) }), { inputMode: "decimal" })}
            {campo("Atualizado em", f.updatedRefDate, (v) => muda({ updatedRefDate: v }), { type: "date" })}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            {campo("Juros (R$)", f.interest, (v) => muda({ interest: MOEDA(v) }), { inputMode: "decimal" })}
            {campo("Multa (R$)", f.fine, (v) => muda({ fine: MOEDA(v) }), { inputMode: "decimal" })}
            {campo("Encargos (R$)", f.charges, (v) => muda({ charges: MOEDA(v) }), { inputMode: "decimal" })}
          </div>
          {campo("Taxa de juros do contrato (% ao mês)", f.contractRatePercent, (v) => muda({ contractRatePercent: v.replace(/[^\d,]/g, "") }), { inputMode: "decimal" })}

          {secao("Datas e origem")}
          {campo("Data de emissão / contratação", f.issueDate, (v) => muda({ issueDate: v }), { type: "date" })}
          {campo("Competência (mês)", f.accrualMonth, (v) => muda({ accrualMonth: v }), { type: "month" })}
          {campo("Vencimento original *", f.dueDate, (v) => muda({ dueDate: v }), { type: "date" })}
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Origem do lançamento *</Label>
            <div className="mt-1 space-y-1">
              {ORIGINS.map((o: DebtOrigin) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type="radio" className="accent-primary" checked={f.origin === o} onChange={() => muda({ origin: o })} />
                  {ORIGIN_LABELS[o]}
                  {sugerida === o && <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">sugerida</span>}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {devedor?.implantacao
                ? `Implantação do riSZon em ${devedor.nome}: ${formatIsoDateBr(devedor.implantacao)}. A sugestão olha a data em que a dívida nasceu (emissão, senão competência), não o vencimento.`
                : "Este devedor ainda não tem data de implantação (aba Configurações): o sistema não sugere a origem."}{" "}
              Os títulos no Contas a Pagar chegam na fase 3; por enquanto a origem fica registrada.
            </p>
            {pedeJustificativa && (
              <label className="mt-1 block">
                <Label className="text-[11px]">Por que a origem difere da sugerida? *</Label>
                <Input className="h-9" value={f.originOverrideReason} onChange={(e) => muda({ originOverrideReason: e.target.value })} />
              </label>
            )}
          </div>

          {secao("Garantias")}
          <div className="space-y-1.5 sm:col-span-2">
            {marca("Tem sócio avalista", f.hasGuarantor, (v) => muda({ hasGuarantor: v }))}
            {f.hasGuarantor && campo("Nome do avalista (só o nome)", f.guarantorName, (v) => muda({ guarantorName: v }))}
            {marca("Cessão de recebíveis de cartão", f.receivablesAssignment, (v) => muda({ receivablesAssignment: v }))}
          </div>
          {campo("Garantia real", f.realGuarantee, (v) => muda({ realGuarantee: v }))}
          {campo("Observações da garantia", f.guaranteeNotes, (v) => muda({ guaranteeNotes: v }))}

          {secao("Gestão")}
          <label className="block">
            <Label className="text-[11px]">Prioridade</Label>
            <select className={SELECT_CLASS} value={f.priority} onChange={(e) => muda({ priority: e.target.value as "" | Priority })}>
              <option value="">—</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label className="text-[11px]">Responsável interno</Label>
            <select className={SELECT_CLASS} value={f.ownerUserId} onChange={(e) => muda({ ownerUserId: e.target.value })}>
              <option value="">—</option>
              {base.responsaveis.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </label>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[11px]">Motivos da prioridade</Label>
            <div className="grid gap-1 sm:grid-cols-2">
              {PRIORITY_REASONS.map((m) => (
                <div key={m}>
                  {marca(PRIORITY_REASON_LABELS[m], f.priorityReasons.includes(m), (v) =>
                    muda({ priorityReasons: v ? [...f.priorityReasons, m] : f.priorityReasons.filter((x) => x !== m) })
                  )}
                </div>
              ))}
            </div>
          </div>
          {campo("Próxima ação", f.nextAction, (v) => muda({ nextAction: v }), { placeholder: "Ex.: ligar para o credor" })}
          {campo("Data da próxima ação", f.nextActionOn, (v) => muda({ nextActionOn: v }), { type: "date" })}
          <label className="block sm:col-span-2">
            <Label className="text-[11px]">Observações</Label>
            <textarea
              className="mt-0.5 min-h-20 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
              value={f.notes}
              onChange={(e) => muda({ notes: e.target.value })}
            />
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" type="button" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={isPending}>
            {f.id ? "Salvar alterações" : "Cadastrar dívida"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
