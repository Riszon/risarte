"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj, formatPhone } from "@/lib/masks";
import { CONTACT_KINDS, CONTACT_KIND_LABELS, valorDevido, type ContactKind, type DebtListRow } from "@/lib/finance/dividas";
import { salvarContato } from "./actions";
import type { BaseDasDividas, Contato } from "./dados";
import { SELECT_CLASS } from "./formulario-da-divida";

type ContatoForm = {
  id: string | null;
  supplierId: string;
  kind: ContactKind;
  organization: string;
  personName: string;
  phone: string;
  whatsapp: string;
  email: string;
  notes: string;
  active: boolean;
};

const vazio = (supplierId: string): ContatoForm => ({
  id: null,
  supplierId,
  kind: "credor",
  organization: "",
  personName: "",
  phone: "",
  whatsapp: "",
  email: "",
  notes: "",
  active: true,
});

/**
 * Aba Credores (0404): o credor é o fornecedor (um cadastro só, D4). Aqui
 * ficam o que é da dívida: quanto se deve a cada um e com quem se fala
 * (atendente, assessoria de cobrança, advogado, cartório).
 */
export function Credores({ base, linhas, podeLancar }: { base: BaseDasDividas; linhas: DebtListRow[]; podeLancar: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editando, setEditando] = useState<ContatoForm | null>(null);
  const [outro, setOutro] = useState("");

  const resumo = useMemo(() => {
    const m = new Map<string, { qtd: number; devido: number }>();
    for (const l of linhas) {
      const r = m.get(l.supplierId) ?? { qtd: 0, devido: 0 };
      r.qtd += 1;
      r.devido += valorDevido(l);
      m.set(l.supplierId, r);
    }
    return m;
  }, [linhas]);

  const comContato = new Set(base.contatos.map((c) => c.supplierId));
  const credores = base.credores
    .filter((c) => resumo.has(c.id) || comContato.has(c.id) || c.id === editando?.supplierId)
    .sort((a, b) => (resumo.get(b.id)?.devido ?? 0) - (resumo.get(a.id)?.devido ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  const tipo = new Map(base.tiposDeCredor.map((k) => [k.code, k.label]));

  const salvar = () => {
    if (!editando) return;
    if (!editando.personName.trim() && !editando.organization.trim()) {
      toast.error("Informe o nome da pessoa ou da empresa.");
      return;
    }
    startTransition(async () => {
      const r = await salvarContato({
        id: editando.id,
        supplier_id: editando.supplierId,
        kind: editando.kind,
        organization: editando.organization,
        person_name: editando.personName,
        phone: editando.phone,
        whatsapp: editando.whatsapp,
        email: editando.email,
        notes: editando.notes,
        active: editando.active,
      });
      if (r.ok) {
        toast.success("Contato salvo.");
        setEditando(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  };

  const editar = (c: Contato) =>
    setEditando({
      id: c.id,
      supplierId: c.supplierId,
      kind: c.kind,
      organization: c.organization ?? "",
      personName: c.personName ?? "",
      phone: c.phone ?? "",
      whatsapp: c.whatsapp ?? "",
      email: c.email ?? "",
      notes: c.notes ?? "",
      active: c.active,
    });

  const muda = (p: Partial<ContatoForm>) => setEditando((e) => (e ? { ...e, ...p } : e));

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      <p className="text-sm text-muted-foreground">
        O credor é o mesmo cadastro de{" "}
        <Link className="text-primary underline" href="/financeiro/fornecedores?todos=1">Fornecedores</Link>
        : razão social, CNPJ, banco e endereço se mudam lá. Aqui ficam os contatos de cobrança.
      </p>

      {podeLancar && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-72">
            <Label className="text-[11px]">Contato para outro credor</Label>
            <ListaComBusca
              value={outro}
              onValueChange={setOutro}
              className="mt-0.5 h-9 w-full"
              options={[{ value: "", label: "— escolha o credor —" }, ...base.credores.filter((c) => c.ativo).map((c) => ({ value: c.id, label: c.nome }))]}
            />
          </label>
          <Button size="sm" className="h-9" disabled={!outro} onClick={() => setEditando(vazio(outro))}>
            <Plus className="size-4" /> Novo contato
          </Button>
        </div>
      )}

      {credores.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">Nenhum credor com dívida ou contato ainda.</CardContent>
        </Card>
      )}

      {credores.map((c) => {
        const r = resumo.get(c.id);
        const contatos = base.contatos.filter((x) => x.supplierId === c.id);
        return (
          <Card key={c.id}>
            <CardContent className="space-y-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {[c.razaoSocial && c.razaoSocial !== c.nome ? c.razaoSocial : null, c.documento?.length === 14 ? formatCnpj(c.documento) : c.documento, c.tipo ? tipo.get(c.tipo) ?? c.tipo : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {r ? (
                    <>
                      <span className="font-semibold tabular-nums">{formatBRL(r.devido)}</span>
                      <span className="block text-xs text-muted-foreground">{r.qtd} dívida{r.qtd === 1 ? "" : "s"}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">sem dívida em aberto</span>
                  )}
                </div>
              </div>
              <ul className="space-y-1 text-sm">
                {contatos.map((x) => (
                  <li key={x.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border px-2 py-1", !x.active && "opacity-60")}>
                    <span className="rounded bg-muted px-1.5 text-[10px]">{CONTACT_KIND_LABELS[x.kind]}</span>
                    <span>{[x.organization, x.personName].filter(Boolean).join(" · ")}</span>
                    {x.phone && <span className="text-xs text-muted-foreground">Tel. {formatPhone(x.phone)}</span>}
                    {x.whatsapp && <span className="text-xs text-muted-foreground">WhatsApp {formatPhone(x.whatsapp)}</span>}
                    {x.email && <span className="text-xs text-muted-foreground">{x.email}</span>}
                    {!x.active && <span className="text-xs">(inativo)</span>}
                    {podeLancar && (
                      <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => editar(x)} aria-label="Editar contato">
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
                {contatos.length === 0 && <li className="text-xs text-muted-foreground">Nenhum contato de cobrança.</li>}
              </ul>
              {podeLancar && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => setEditando(vazio(c.id))}>
                  <Plus className="size-3.5" /> Contato
                </Button>
              )}
              {editando && editando.supplierId === c.id && (
                <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-sm sm:grid-cols-2">
                  <label className="block">
                    <Label className="text-[11px]">Tipo</Label>
                    <select className={SELECT_CLASS} value={editando.kind} onChange={(e) => muda({ kind: e.target.value as ContactKind })}>
                      {CONTACT_KINDS.map((k) => (
                        <option key={k} value={k}>{CONTACT_KIND_LABELS[k]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Empresa / assessoria</Label>
                    <Input className="h-9" value={editando.organization} onChange={(e) => muda({ organization: e.target.value })} />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Nome do atendente</Label>
                    <Input className="h-9" value={editando.personName} onChange={(e) => muda({ personName: e.target.value })} />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">E-mail</Label>
                    <Input className="h-9" inputMode="email" value={editando.email} onChange={(e) => muda({ email: e.target.value })} />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Telefone</Label>
                    <Input className="h-9" inputMode="tel" value={formatPhone(editando.phone)} onChange={(e) => muda({ phone: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">WhatsApp</Label>
                    <Input className="h-9" inputMode="tel" value={formatPhone(editando.whatsapp)} onChange={(e) => muda({ whatsapp: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
                  </label>
                  <label className="block sm:col-span-2">
                    <Label className="text-[11px]">Observações</Label>
                    <Input className="h-9" value={editando.notes} onChange={(e) => muda({ notes: e.target.value })} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-primary" checked={editando.active} onChange={(e) => muda({ active: e.target.checked })} />
                    Ativo
                  </label>
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                    <Button size="sm" onClick={salvar} disabled={isPending}>Salvar contato</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

    </div>
  );
}
