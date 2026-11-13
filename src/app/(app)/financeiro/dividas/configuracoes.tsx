"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { cn } from "@/lib/utils";
import { formatCnpj } from "@/lib/masks";
import { campoDeCentavos, centavosDoCampo } from "@/lib/finance/dividas";
import {
  salvarCartorio,
  salvarCategoria,
  salvarEtiqueta,
  salvarImplantacao,
  salvarNatureza,
  salvarPrazoPorTipo,
  salvarRegra,
  voltarARegraDaRede,
} from "./actions";
import type { BaseDasDividas, Cartorio, Categoria, Regra } from "./dados";
import { SELECT_CLASS } from "./formulario-da-divida";

const RECONHECIMENTO = [
  { value: "na_data_do_acordo", label: "Na data do acordo (estorna se o credor restabelecer a dívida)" },
  { value: "proporcional", label: "Aos poucos, a cada parcela paga" },
];

const numero = (v: string) => v.replace(/\D/g, "").slice(0, 3);
const ou = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function Secao({ titulo, children, descricao }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div>
          <h2 className="font-semibold">{titulo}</h2>
          {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Aba Configurações do Levantamento de Dívidas (0404). Tudo sem programação:
 * criar, editar, reordenar e DESATIVAR (desativado some dos lançamentos novos
 * e continua nas dívidas antigas). Cada alteração vai para a auditoria.
 */
export function Configuracoes({ base, podeConfigurar }: { base: BaseDasDividas; podeConfigurar: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const rede = base.regras.find((r) => r.clinicId === null) ?? null;

  const executar = (fn: () => Promise<{ ok: boolean; error?: string }>, ok = "Salvo.") =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });

  if (!podeConfigurar) {
    return <p className="text-sm text-muted-foreground">Só quem tem a permissão “Configurar o Levantamento de Dívidas” mexe aqui.</p>;
  }

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      <RegraDaRede rede={rede} executar={executar} />
      <PorDevedor base={base} executar={executar} />
      <PrazoPorTipo base={base} executar={executar} />
      <Categorias base={base} executar={executar} />
      <Naturezas base={base} executar={executar} />
      <Etiquetas base={base} executar={executar} />
      <Cartorios cartorios={base.cartorios} executar={executar} />
    </div>
  );
}

type Executar = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;

function RegraDaRede({ rede, executar }: { rede: Regra | null; executar: Executar }) {
  const [v, setV] = useState({
    days_to_default: ou(rede?.daysToDefault ?? 30),
    about_to_default_days: ou(rede?.aboutToDefaultDays),
    proposal_alert_days: (rede?.proposalAlertDays ?? [7, 2]).join(", "),
    negativation_removal_bdays: ou(rede?.negativationRemovalBdays),
    closing_stale_days: ou(rede?.closingStaleDays),
    agreement_broken_tolerance_bdays: ou(rede?.agreementBrokenToleranceBdays),
    limite: campoDeCentavos(rede?.agreementApprovalThresholdCents ?? null),
    discount_recognition: rede?.discountRecognition ?? "na_data_do_acordo",
    surcharge_recognition: rede?.surchargeRecognition ?? "na_data_do_acordo",
    stale_check_days: ou(rede?.staleCheckDays ?? 60),
  });
  const muda = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const campo = (rotulo: string, chave: keyof typeof v, ajuda?: string) => (
    <label className="block">
      <Label className="text-[11px]">{rotulo}</Label>
      <Input className="h-9" inputMode="numeric" value={v[chave]} onChange={(e) => muda({ [chave]: numero(e.target.value) })} />
      {ajuda && <span className="text-[11px] text-muted-foreground">{ajuda}</span>}
    </label>
  );

  const salvar = () => {
    const limite = centavosDoCampo(v.limite);
    if (Number.isNaN(limite)) return toast.error("O valor para aprovação não é válido (use 1.234,56).");
    if (!v.days_to_default) return toast.error("Informe o prazo para virar inadimplente.");
    executar(() =>
      salvarRegra(null, {
        days_to_default: v.days_to_default,
        about_to_default_days: v.about_to_default_days,
        proposal_alert_days: v.proposal_alert_days.split(/[,;\s]+/).filter(Boolean),
        negativation_removal_bdays: v.negativation_removal_bdays,
        closing_stale_days: v.closing_stale_days,
        agreement_broken_tolerance_bdays: v.agreement_broken_tolerance_bdays,
        agreement_approval_threshold_cents: limite,
        discount_recognition: v.discount_recognition,
        surcharge_recognition: v.surcharge_recognition,
        stale_check_days: v.stale_check_days,
      }), "Regra da rede salva. A situação das dívidas foi recalculada."
    );
  };

  return (
    <Secao titulo="Regra da rede" descricao="Vale para todos os devedores, a não ser que um devedor ou um tipo de credor tenha prazo próprio.">
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        {campo("Dias após o vencimento para virar inadimplente *", "days_to_default", "Do 1º dia até este, “Em atraso”; depois, “Inadimplente”.")}
        {campo("Avisar quantos dias antes de virar inadimplente", "about_to_default_days")}
        <label className="block">
          <Label className="text-[11px]">Avisar validade da proposta (dias antes)</Label>
          <Input className="h-9" value={v.proposal_alert_days} onChange={(e) => muda({ proposal_alert_days: e.target.value.replace(/[^\d,\s]/g, "") })} />
          <span className="text-[11px] text-muted-foreground">Separados por vírgula. Ex.: 7, 2</span>
        </label>
        {campo("Prazo para a baixa da negativação (dias úteis)", "negativation_removal_bdays")}
        {campo("Checklist de encerramento parado (dias)", "closing_stale_days")}
        {campo("Tolerância para acordo quebrado (dias úteis)", "agreement_broken_tolerance_bdays", "Cada acordo pode ter a sua, conforme o termo.")}
        {campo("Pedir nova conferência depois de (dias)", "stale_check_days", "Selo “Conferir” na dívida conferida há mais tempo.")}
        <label className="block">
          <Label className="text-[11px]">Acordo acima de (R$) precisa de aprovação do Admin Master</Label>
          <Input className="h-9" inputMode="decimal" placeholder="vazio = desligado" value={v.limite} onChange={(e) => muda({ limite: e.target.value.replace(/[^\d.,]/g, "") })} />
        </label>
        <label className="block sm:col-span-3">
          <Label className="text-[11px]">Quando o desconto obtido num acordo entra na DRE</Label>
          <select className={SELECT_CLASS} value={v.discount_recognition} onChange={(e) => muda({ discount_recognition: e.target.value })}>
            {RECONHECIMENTO.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-3">
          <Label className="text-[11px]">Quando os encargos de um acordo mais caro entram na DRE</Label>
          <select className={SELECT_CLASS} value={v.surcharge_recognition} onChange={(e) => muda({ surcharge_recognition: e.target.value })}>
            {RECONHECIMENTO.map((o) => (
              <option key={o.value} value={o.value}>{o.label.replace(" (estorna se o credor restabelecer a dívida)", "")}</option>
            ))}
          </select>
          <span className="text-[11px] text-amber-700 dark:text-amber-300">A validar com o contador. Os acordos chegam na fase 5; a escolha fica gravada desde já.</span>
        </label>
      </div>
      <Button size="sm" onClick={salvar}>Salvar regra da rede</Button>
    </Secao>
  );
}

function PorDevedor({ base, executar }: { base: BaseDasDividas; executar: Executar }) {
  const [datas, setDatas] = useState<Record<string, string>>(Object.fromEntries(base.devedores.map((d) => [d.id, d.implantacao ?? ""])));
  const [prazos, setPrazos] = useState<Record<string, string>>(
    Object.fromEntries(base.devedores.map((d) => [d.id, ou(base.regras.find((r) => r.clinicId === d.id)?.daysToDefault)]))
  );
  const rede = base.regras.find((r) => r.clinicId === null)?.daysToDefault ?? 30;
  return (
    <Secao
      titulo="Devedores: data de implantação e prazo próprio"
      descricao="A data de implantação do riSZon decide a origem sugerida (A = dívida que nasceu antes; B = depois). Prazo vazio = segue a rede."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Devedor</th>
              <th className="py-1 pr-2">Implantação do riSZon</th>
              <th className="py-1 pr-2">Dias para inadimplente</th>
            </tr>
          </thead>
          <tbody>
            {base.devedores.map((d) => {
              const proprio = base.regras.some((r) => r.clinicId === d.id);
              return (
                <tr key={d.id} className="border-t align-top">
                  <td className="py-2 pr-2">
                    {d.nome}
                    {d.franqueadora && " (franqueadora)"}
                    <span className="block text-[11px] text-muted-foreground">{d.cnpj ? formatCnpj(d.cnpj) : "sem CNPJ cadastrado"}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-1">
                      <Input className="h-8 w-40" type="date" value={datas[d.id] ?? ""} onChange={(e) => setDatas((x) => ({ ...x, [d.id]: e.target.value }))} />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => executar(() => salvarImplantacao(d.id, datas[d.id] || null), "Data de implantação salva.")}>
                        Salvar
                      </Button>
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-1">
                      <Input
                        className="h-8 w-24"
                        inputMode="numeric"
                        placeholder={`rede: ${rede}`}
                        value={prazos[d.id] ?? ""}
                        onChange={(e) => setPrazos((x) => ({ ...x, [d.id]: numero(e.target.value) }))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() =>
                          prazos[d.id]
                            ? executar(() => salvarRegra(d.id, { days_to_default: prazos[d.id] }), "Prazo do devedor salvo.")
                            : proprio
                              ? executar(() => voltarARegraDaRede(d.id), "Voltou a seguir a rede.")
                              : toast.info("Vazio = segue a rede.")
                        }
                      >
                        Salvar
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

function PrazoPorTipo({ base, executar }: { base: BaseDasDividas; executar: Executar }) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(base.prazosPorTipo.map((p) => [p.supplierKind, String(p.days)])));
  return (
    <Secao titulo="Prazo por tipo de credor" descricao="Ganha do prazo do devedor e da rede (ex.: tributos e bancos com prazo menor). Vazio = sem prazo próprio.">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        {base.tiposDeCredor
          .filter((k) => k.active || v[k.code])
          .map((k) => (
            <div key={k.code} className="flex items-center gap-2">
              <span className="flex-1">{k.label}</span>
              <Input className="h-8 w-20" inputMode="numeric" value={v[k.code] ?? ""} onChange={(e) => setV((x) => ({ ...x, [k.code]: numero(e.target.value) }))} />
              <Button size="sm" variant="outline" className="h-8" onClick={() => executar(() => salvarPrazoPorTipo(k.code, v[k.code] ? Number(v[k.code]) : null), "Prazo salvo.")}>
                Salvar
              </Button>
            </div>
          ))}
      </div>
    </Secao>
  );
}

type CatForm = {
  id: string | null;
  parentId: string | null;
  name: string;
  nature: string;
  opening: string;
  expense: string;
  order: string;
  active: boolean;
};

function Categorias({ base, executar }: { base: BaseDasDividas; executar: Executar }) {
  const [edit, setEdit] = useState<CatForm | null>(null);
  const raiz = base.categorias.filter((c) => c.parentId === null);
  const conta = new Map(base.contas.map((a) => [a.code, `${a.code} · ${a.name}`]));
  const nat = new Map(base.naturezas.map((n) => [n.code, n.label]));
  const abrir = (c: Categoria | null, parentId: string | null = null) =>
    setEdit(
      c
        ? { id: c.id, parentId: c.parentId, name: c.nome, nature: c.natureza ?? "", opening: c.contaAbertura ?? "", expense: c.contaDespesa ?? "", order: String(c.ordem), active: c.ativa }
        : { id: null, parentId, name: "", nature: "", opening: "", expense: "", order: "100", active: true }
    );
  const salvar = () => {
    if (!edit) return;
    if (!edit.name.trim()) return toast.error("Dê um nome à categoria.");
    executar(async () => {
      const r = await salvarCategoria({
        id: edit.id,
        parent_id: edit.parentId,
        name: edit.name,
        nature_code: edit.nature || null,
        opening_account_code: edit.opening || null,
        expense_account_code: edit.expense || null,
        sort_order: Number(edit.order || "0"),
        active: edit.active,
      });
      if (r.ok) setEdit(null);
      return r;
    }, "Categoria salva.");
  };
  const opcoesDeConta = [{ value: "", label: "— nenhuma —" }, ...base.contas.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))];

  const formulario = (
    edit && (
      <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-sm sm:grid-cols-2">
        <p className="text-xs font-medium sm:col-span-2">
          {edit.id ? "Editar" : "Nova"} {edit.parentId ? `subcategoria de “${base.categorias.find((c) => c.id === edit.parentId)?.nome ?? ""}”` : "categoria"}
        </p>
        <label className="block">
          <Label className="text-[11px]">Nome *</Label>
          <Input className="h-9" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        </label>
        <label className="block">
          <Label className="text-[11px]">Ordem</Label>
          <Input className="h-9" inputMode="numeric" value={edit.order} onChange={(e) => setEdit({ ...edit, order: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
        </label>
        {!edit.parentId && (
          <>
            <label className="block">
              <Label className="text-[11px]">Natureza</Label>
              <select className={SELECT_CLASS} value={edit.nature} onChange={(e) => setEdit({ ...edit, nature: e.target.value })}>
                <option value="">—</option>
                {base.naturezas.filter((n) => n.ativa || n.code === edit.nature).map((n) => (
                  <option key={n.code} value={n.code}>{n.label}</option>
                ))}
              </select>
            </label>
            <div />
            <label className="block">
              <Label className="text-[11px]">Conta da dívida anterior à implantação (origem A)</Label>
              <ListaComBusca value={edit.opening} onValueChange={(v) => setEdit({ ...edit, opening: v })} className="mt-0.5 h-9 w-full" options={opcoesDeConta} />
              <span className="text-[11px] text-muted-foreground">As contas de saldo de implantação (fora da DRE) chegam na fase 3.</span>
            </label>
            <label className="block">
              <Label className="text-[11px]">Conta da despesa (origem B)</Label>
              <ListaComBusca value={edit.expense} onValueChange={(v) => setEdit({ ...edit, expense: v })} className="mt-0.5 h-9 w-full" options={opcoesDeConta} />
            </label>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
          Ativa (desativada some dos lançamentos novos e continua nas dívidas antigas)
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
          <Button size="sm" onClick={salvar}>Salvar</Button>
        </div>
      </div>
    )
  );

  return (
    <Secao
      titulo="Categorias e subcategorias"
      descricao="A dívida escolhe a categoria; natureza e conta do plano de contas vêm dela (e podem ser trocadas na dívida). Contas a validar com o contador."
    >
      <ul className="space-y-1.5 text-sm">
        {raiz.map((c) => (
          <li key={c.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={cn("font-medium hover:underline", !c.ativa && "line-through opacity-60")} onClick={() => abrir(c)}>
                {c.nome}
              </button>
              {c.natureza && <span className="rounded bg-muted px-1.5 text-[10px]">{nat.get(c.natureza) ?? c.natureza}</span>}
              {(c.contaAbertura || c.contaDespesa) && (
                <span className="text-[11px] text-muted-foreground">
                  {c.contaAbertura && `A: ${conta.get(c.contaAbertura) ?? c.contaAbertura}`}
                  {c.contaAbertura && c.contaDespesa && " · "}
                  {c.contaDespesa && `B: ${conta.get(c.contaDespesa) ?? c.contaDespesa}`}
                </span>
              )}
              <button type="button" className="ml-auto text-[11px] text-primary underline" onClick={() => abrir(null, c.id)}>
                + subcategoria
              </button>
            </div>
            {base.categorias.some((s) => s.parentId === c.id) && (
              <div className="mt-1 flex flex-wrap gap-1.5 pl-3">
                {base.categorias
                  .filter((s) => s.parentId === c.id)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => abrir(s)}
                      className={cn("rounded-full border px-2 py-0.5 text-xs hover:bg-muted", !s.ativa && "line-through opacity-60")}
                    >
                      {s.nome}
                    </button>
                  ))}
              </div>
            )}
            {edit && (edit.id === c.id || edit.parentId === c.id) && <div className="mt-2">{formulario}</div>}
          </li>
        ))}
      </ul>
      {edit && edit.parentId === null && edit.id === null && formulario}
      <Button size="sm" variant="outline" onClick={() => abrir(null)}>
        <Plus className="size-4" /> Nova categoria
      </Button>
    </Secao>
  );
}

function Naturezas({ base, executar }: { base: BaseDasDividas; executar: Executar }) {
  const [nova, setNova] = useState("");
  const [nomes, setNomes] = useState<Record<string, string>>(Object.fromEntries(base.naturezas.map((n) => [n.code, n.label])));
  return (
    <Secao titulo="Naturezas" descricao="Agrupam as categorias (quanto é bancário, operacional, tributário, trabalhista).">
      <ul className="space-y-1.5 text-sm">
        {base.naturezas.map((n) => (
          <li key={n.code} className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-56" value={nomes[n.code] ?? ""} onChange={(e) => setNomes((x) => ({ ...x, [n.code]: e.target.value }))} />
            <Button size="sm" variant="outline" className="h-8" onClick={() => executar(() => salvarNatureza({ code: n.code, label: nomes[n.code] ?? n.label, sort_order: n.ordem, active: n.ativa }))}>
              Salvar nome
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => executar(() => salvarNatureza({ code: n.code, label: n.label, sort_order: n.ordem, active: !n.ativa }))}>
              {n.ativa ? "Desativar" : "Reativar"}
            </Button>
            {!n.ativa && <span className="text-xs text-muted-foreground">(desativada)</span>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input className="h-8 w-56" placeholder="Nova natureza" value={nova} onChange={(e) => setNova(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!nova.trim()}
          onClick={() => {
            executar(() => salvarNatureza({ code: null, label: nova, sort_order: 100, active: true }), "Natureza criada.");
            setNova("");
          }}
        >
          <Plus className="size-4" /> Criar
        </Button>
      </div>
    </Secao>
  );
}

function Etiquetas({ base, executar }: { base: BaseDasDividas; executar: Executar }) {
  const [nomes, setNomes] = useState<Record<string, string>>(Object.fromEntries(base.etiquetas.map((t) => [t.id, t.nome])));
  return (
    <Secao titulo="Etiquetas" descricao="Criadas na hora, no cadastro da dívida. Aqui se renomeia ou desativa.">
      {base.etiquetas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma etiqueta ainda.</p>}
      <ul className="space-y-1.5 text-sm">
        {base.etiquetas.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-56" value={nomes[t.id] ?? ""} onChange={(e) => setNomes((x) => ({ ...x, [t.id]: e.target.value }))} />
            <Button size="sm" variant="outline" className="h-8" onClick={() => executar(() => salvarEtiqueta({ id: t.id, name: nomes[t.id] ?? t.nome, color: t.cor, active: t.ativa }))}>
              Salvar nome
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => executar(() => salvarEtiqueta({ id: t.id, name: t.nome, color: t.cor, active: !t.ativa }))}>
              {t.ativa ? "Desativar" : "Reativar"}
            </Button>
            {!t.ativa && <span className="text-xs text-muted-foreground">(desativada)</span>}
          </li>
        ))}
      </ul>
    </Secao>
  );
}

function Cartorios({ cartorios, executar }: { cartorios: Cartorio[]; executar: Executar }) {
  const [edit, setEdit] = useState<{ id: string | null; nome: string; cidade: string; uf: string; telefone: string; email: string; ativo: boolean } | null>(null);
  const abrir = (c: Cartorio | null) =>
    setEdit({
      id: c?.id ?? null,
      nome: c?.nome ?? "",
      cidade: c?.cidade ?? "",
      uf: c?.uf ?? "",
      telefone: c?.telefone ?? "",
      email: c?.email ?? "",
      ativo: c?.ativo ?? true,
    });
  const salvar = () => {
    if (!edit?.nome.trim()) return toast.error("Informe o nome do cartório.");
    executar(async () => {
      const r = await salvarCartorio({
        id: edit.id,
        name: edit.nome,
        city: edit.cidade,
        state: edit.uf,
        phone: edit.telefone,
        email: edit.email,
        active: edit.ativo,
      });
      if (r.ok) setEdit(null);
      return r;
    }, "Cartório salvo.");
  };
  return (
    <Secao titulo="Cartórios de protesto" descricao="Cadastrados uma vez e escolhidos nos protestos. Também dá para cadastrar na hora, no protesto.">
      {cartorios.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cartório cadastrado.</p>}
      <ul className="space-y-1 text-sm">
        {cartorios.map((c) => (
          <li key={c.id} className={cn("flex flex-wrap items-center gap-2", !c.ativo && "opacity-60")}>
            <button type="button" className="hover:underline" onClick={() => abrir(c)}>
              {c.nome}
            </button>
            <span className="text-xs text-muted-foreground">{[[c.cidade, c.uf].filter(Boolean).join("/"), c.telefone, c.email].filter(Boolean).join(" · ")}</span>
            {!c.ativo && <span className="text-xs">(desativado)</span>}
          </li>
        ))}
      </ul>
      {edit && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-sm sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <Label className="text-[11px]">Nome *</Label>
            <Input className="h-9" value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
          </label>
          <label className="block">
            <Label className="text-[11px]">Cidade</Label>
            <Input className="h-9" value={edit.cidade} onChange={(e) => setEdit({ ...edit, cidade: e.target.value })} />
          </label>
          <label className="block">
            <Label className="text-[11px]">UF</Label>
            <Input className="h-9" value={edit.uf} onChange={(e) => setEdit({ ...edit, uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) })} />
          </label>
          <label className="block">
            <Label className="text-[11px]">Telefone</Label>
            <Input className="h-9" inputMode="tel" value={edit.telefone} onChange={(e) => setEdit({ ...edit, telefone: e.target.value })} />
          </label>
          <label className="block">
            <Label className="text-[11px]">E-mail</Label>
            <Input className="h-9" inputMode="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
          </label>
          {edit.id && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} />
              Ativo
            </label>
          )}
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button size="sm" onClick={salvar}>Salvar</Button>
          </div>
        </div>
      )}
      {!edit && (
        <Button size="sm" variant="outline" onClick={() => abrir(null)}>
          <Plus className="size-4" /> Novo cartório
        </Button>
      )}
    </Secao>
  );
}
