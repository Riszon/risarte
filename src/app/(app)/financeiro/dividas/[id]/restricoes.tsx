"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import {
  BUREAUS,
  BUREAU_LABELS,
  CONSENT_LABELS,
  PROTEST_CANCEL_LABELS,
  campoDeCentavos,
  centavosDoCampo,
  type Bureau,
  type ConsentLetter,
  type ProtestCancel,
} from "@/lib/finance/dividas";
import {
  removerRegistro,
  salvarAcaoJudicial,
  salvarCartorio,
  salvarNegativacao,
  salvarNotificacao,
  salvarProtesto,
} from "../actions";
import type { AcaoJudicial, Cartorio, DetalheDaFase2, Negativacao, Notificacao, Protesto } from "../dados";
import { Caixa, Campo, Marca, RemoverComMotivo, Removido, SELECT, moeda, useAcao } from "./comum";

type Tipo = "negativacao" | "protesto" | "acao_judicial" | "notificacao";

const cents = (v: string) => {
  const c = centavosDoCampo(v);
  return c === null || Number.isNaN(c) ? null : c;
};
const valido = (v: string, nome: string) => {
  if (Number.isNaN(centavosDoCampo(v))) {
    toast.error(`${nome}: valor inválido (use 1.234,56).`);
    return false;
  }
  return true;
};

/**
 * Aba Restrições (3.3, 0405): negativação, protesto, ação judicial e
 * notificação extrajudicial. Corrigir = editar (vai para o histórico);
 * lançado por engano = remover com motivo (o registro fica).
 */
export function Restricoes({
  debtId,
  groupId,
  groupLabel,
  fase2,
  cartorios,
  podeLancar,
}: {
  debtId: string;
  groupId: string | null;
  groupLabel: string | null;
  fase2: DetalheDaFase2;
  cartorios: Cartorio[];
  podeLancar: boolean;
}) {
  const { ocupado, rodar } = useAcao();
  const [verRemovidos, setVerRemovidos] = useState(false);
  const [remover, setRemover] = useState<{ tipo: Tipo; id: string; titulo: string } | null>(null);
  const [neg, setNeg] = useState<Record<string, string | boolean> | null>(null);
  const [pro, setPro] = useState<Record<string, string | boolean> | null>(null);
  const [aca, setAca] = useState<Record<string, string | boolean> | null>(null);
  const [not, setNot] = useState<Record<string, string> | null>(null);
  const [novoCartorio, setNovoCartorio] = useState<{ nome: string; cidade: string; uf: string } | null>(null);
  const [listaCartorios, setListaCartorios] = useState(cartorios);

  const visivel = <T extends { removedAt: string | null }>(l: T[]) => l.filter((x) => verRemovidos || !x.removedAt);
  const removidos = [fase2.negativacoes, fase2.protestos, fase2.acoes, fase2.notificacoes].flat().filter((x) => x.removedAt).length;
  const nomeDoCartorio = (id: string | null) => {
    const c = listaCartorios.find((x) => x.id === id);
    return c ? [c.nome, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(" — ") : null;
  };

  // ---- negativação
  const abrirNeg = (n: Negativacao | null) =>
    setNeg({
      id: n?.id ?? "",
      bureau: n?.bureau ?? "serasa",
      included_on: n?.includedOn ?? "",
      amount: campoDeCentavos(n?.amountCents ?? null),
      in_limpa_nome: n?.inLimpaNome ?? false,
      target: n?.target ?? "empresa",
      target_name: n?.targetName ?? "",
      removal_confirmed_on: n?.removalConfirmedOn ?? "",
      notes: n?.notes ?? "",
    });
  const salvarNeg = () => {
    if (!neg || !valido(String(neg.amount), "Valor negativado")) return;
    if (neg.target === "socio" && !String(neg.target_name).trim()) return toast.error("Informe o nome do sócio.");
    rodar(
      () =>
        salvarNegativacao(debtId, {
          id: neg.id || null,
          debt_id: debtId,
          bureau: neg.bureau,
          included_on: neg.included_on || null,
          amount_cents: cents(String(neg.amount)),
          in_limpa_nome: neg.in_limpa_nome,
          target: neg.target,
          target_name: neg.target_name,
          removal_confirmed_on: neg.removal_confirmed_on || null,
          notes: neg.notes,
        }),
      "Negativação salva.",
      () => setNeg(null)
    );
  };

  // ---- protesto
  const abrirPro = (p: Protesto | null) =>
    setPro({
      id: p?.id ?? "",
      escopo: p ? (p.groupId ? "grupo" : "divida") : "divida",
      notary_office_id: p?.notaryOfficeId ?? "",
      protocol: p?.protocol ?? "",
      protested_on: p?.protestedOn ?? "",
      amount: campoDeCentavos(p?.amountCents ?? null),
      cost: campoDeCentavos(p?.cancelCostCents ?? null),
      cost_quoted_on: p?.costQuotedOn ?? "",
      consent_letter: p?.consentLetter ?? "pendente",
      cancel_status: p?.cancelStatus ?? "pendente",
      cancelled_on: p?.cancelledOn ?? "",
      notes: p?.notes ?? "",
    });
  const salvarPro = () => {
    if (!pro || !valido(String(pro.amount), "Valor protestado") || !valido(String(pro.cost), "Custas")) return;
    if (pro.cancel_status === "cancelado" && !pro.cancelled_on) return toast.error("Informe a data do cancelamento.");
    rodar(
      () =>
        salvarProtesto(debtId, {
          id: pro.id || null,
          debt_id: pro.escopo === "grupo" ? null : debtId,
          group_id: pro.escopo === "grupo" ? groupId : null,
          notary_office_id: pro.notary_office_id || null,
          protocol: pro.protocol,
          protested_on: pro.protested_on || null,
          amount_cents: cents(String(pro.amount)),
          cancel_cost_cents: cents(String(pro.cost)),
          cost_quoted_on: pro.cost_quoted_on || null,
          consent_letter: pro.consent_letter,
          cancel_status: pro.cancel_status,
          cancelled_on: pro.cancelled_on || null,
          notes: pro.notes,
        }),
      "Protesto salvo.",
      () => setPro(null)
    );
  };
  const criarCartorio = () => {
    if (!novoCartorio?.nome.trim()) return toast.error("Informe o nome do cartório.");
    rodar(
      async () => {
        const r = await salvarCartorio({ name: novoCartorio.nome, city: novoCartorio.cidade, state: novoCartorio.uf });
        if (r.ok && r.id) {
          setListaCartorios((l) => [...l, { id: r.id!, nome: novoCartorio.nome, cidade: novoCartorio.cidade || null, uf: novoCartorio.uf.toUpperCase() || null, telefone: null, email: null, notas: null, ativo: true }]);
          setPro((p) => (p ? { ...p, notary_office_id: r.id! } : p));
          setNovoCartorio(null);
        }
        return r;
      },
      "Cartório cadastrado."
    );
  };

  // ---- ação judicial
  const abrirAca = (a: AcaoJudicial | null) =>
    setAca({
      id: a?.id ?? "",
      process_number: a?.processNumber ?? "",
      court: a?.court ?? "",
      district: a?.district ?? "",
      phase: a?.phase ?? "",
      claim: campoDeCentavos(a?.claimCents ?? null),
      lawyer_name: a?.lawyerName ?? "",
      has_freeze: a?.hasFreeze ?? false,
      has_seizure: a?.hasSeizure ?? false,
      has_search_and_seizure: a?.hasSearchAndSeizure ?? false,
      closed_on: a?.closedOn ?? "",
      notes: a?.notes ?? "",
    });
  const salvarAca = () => {
    if (!aca || !valido(String(aca.claim), "Valor da causa")) return;
    if (!String(aca.process_number).trim() && !String(aca.court).trim()) return toast.error("Informe o número do processo ou a vara.");
    rodar(
      () =>
        salvarAcaoJudicial(debtId, {
          id: aca.id || null,
          debt_id: debtId,
          process_number: aca.process_number,
          court: aca.court,
          district: aca.district,
          phase: aca.phase,
          claim_cents: cents(String(aca.claim)),
          lawyer_name: aca.lawyer_name,
          has_freeze: aca.has_freeze,
          has_seizure: aca.has_seizure,
          has_search_and_seizure: aca.has_search_and_seizure,
          closed_on: aca.closed_on || null,
          notes: aca.notes,
        }),
      "Ação judicial salva.",
      () => setAca(null)
    );
  };

  // ---- notificação
  const abrirNot = (n: Notificacao | null) => setNot({ id: n?.id ?? "", received_on: n?.receivedOn ?? "", notes: n?.notes ?? "" });
  const salvarNot = () => {
    if (!not?.received_on) return toast.error("Informe a data em que chegou.");
    rodar(
      () => salvarNotificacao(debtId, { id: not.id || null, debt_id: debtId, received_on: not.received_on, notes: not.notes }),
      "Notificação salva.",
      () => setNot(null)
    );
  };

  const acoes = (tipo: Tipo, id: string, titulo: string, editar: () => void, removido: boolean) =>
    podeLancar && !removido ? (
      <span className="ml-auto flex gap-1">
        <button type="button" aria-label="Editar" className="text-muted-foreground hover:text-foreground" onClick={editar}>
          <Pencil className="size-3.5" />
        </button>
        <button type="button" aria-label="Remover" className="text-muted-foreground hover:text-destructive" onClick={() => setRemover({ tipo, id, titulo })}>
          <Trash2 className="size-3.5" />
        </button>
      </span>
    ) : null;

  const secao = (titulo: string, novo: () => void, vazio: boolean, corpo: React.ReactNode, form: React.ReactNode) => (
    <Card>
      <CardContent className="space-y-2 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          {podeLancar && (
            <Button size="sm" variant="outline" className="h-7" onClick={novo}>
              <Plus className="size-3.5" /> Lançar
            </Button>
          )}
        </div>
        {vazio && <p className="text-xs text-muted-foreground">Nada lançado.</p>}
        {corpo}
        {form}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {removidos > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="accent-primary" checked={verRemovidos} onChange={(e) => setVerRemovidos(e.target.checked)} />
          Mostrar os {removidos} removido{removidos === 1 ? "" : "s"}
        </label>
      )}

      {secao(
        "Negativação",
        () => abrirNeg(null),
        visivel(fase2.negativacoes).length === 0,
        <ul className="space-y-1 text-sm">
          {visivel(fase2.negativacoes).map((n) => (
            <li key={n.id} className={cn("rounded-md border px-2 py-1.5", n.removedAt && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{BUREAU_LABELS[n.bureau as Bureau] ?? n.bureau}</span>
                {n.inLimpaNome && <span className="rounded bg-muted px-1.5 text-[10px]">Serasa Limpa Nome</span>}
                <span className={cn("rounded px-1.5 text-[10px]", n.removalConfirmedOn ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200")}>
                  {n.removalConfirmedOn ? `baixa confirmada em ${formatIsoDateBr(n.removalConfirmedOn)}` : "ativa"}
                </span>
                {acoes("negativacao", n.id, "Remover a negativação", () => abrirNeg(n), !!n.removedAt)}
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  n.target === "socio" ? `No sócio: ${n.targetName}` : "No CNPJ da empresa",
                  n.includedOn && `incluída em ${formatIsoDateBr(n.includedOn)}`,
                  n.amountCents !== null && formatBRL(n.amountCents),
                  n.notes,
                ].filter(Boolean).join(" · ")}
              </p>
              <Removido em={n.removedAt} motivo={n.removedReason} />
            </li>
          ))}
        </ul>,
        neg && (
          <Caixa titulo={neg.id ? "Editar negativação" : "Nova negativação"} onCancelar={() => setNeg(null)} onSalvar={salvarNeg} ocupado={ocupado}>
            <label className="block">
              <Label className="text-[11px]">Órgão *</Label>
              <select className={SELECT} value={String(neg.bureau)} onChange={(e) => setNeg({ ...neg, bureau: e.target.value })}>
                {BUREAUS.map((b) => (
                  <option key={b} value={b}>{BUREAU_LABELS[b]}</option>
                ))}
              </select>
            </label>
            <Campo rotulo="Data da inclusão" type="date" valor={String(neg.included_on)} onChange={(v) => setNeg({ ...neg, included_on: v })} />
            <Campo rotulo="Valor negativado (R$)" inputMode="decimal" valor={String(neg.amount)} onChange={(v) => setNeg({ ...neg, amount: moeda(v) })} />
            <div className="flex items-end pb-2">
              <Marca rotulo="Consta no Serasa Limpa Nome" valor={neg.in_limpa_nome === true} onChange={(v) => setNeg({ ...neg, in_limpa_nome: v })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px]">Quem está negativado</Label>
              <div className="flex gap-4">
                {(["empresa", "socio"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" className="accent-primary" checked={neg.target === t} onChange={() => setNeg({ ...neg, target: t })} />
                    {t === "empresa" ? "O CNPJ da empresa" : "O sócio avalista"}
                  </label>
                ))}
              </div>
            </div>
            {neg.target === "socio" && (
              <Campo rotulo="Nome do sócio (só o nome) *" valor={String(neg.target_name)} onChange={(v) => setNeg({ ...neg, target_name: v })} />
            )}
            <Campo rotulo="Baixa confirmada em" type="date" valor={String(neg.removal_confirmed_on)} onChange={(v) => setNeg({ ...neg, removal_confirmed_on: v })} />
            <Campo className="sm:col-span-2" rotulo="Observações" valor={String(neg.notes)} onChange={(v) => setNeg({ ...neg, notes: v })} />
          </Caixa>
        )
      )}

      {secao(
        "Protesto",
        () => abrirPro(null),
        visivel(fase2.protestos).length === 0,
        <ul className="space-y-1 text-sm">
          {visivel(fase2.protestos).map((p) => (
            <li key={p.id} className={cn("rounded-md border px-2 py-1.5", p.removedAt && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{nomeDoCartorio(p.notaryOfficeId) ?? "Cartório não informado"}</span>
                {p.groupId && <span className="rounded bg-muted px-1.5 text-[10px]">do grupo {groupLabel ?? ""}</span>}
                <span className={cn("rounded px-1.5 text-[10px]", p.cancelStatus === "cancelado" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200")}>
                  {p.cancelStatus === "cancelado" ? `cancelado em ${formatIsoDateBr(p.cancelledOn)}` : `cancelamento: ${PROTEST_CANCEL_LABELS[p.cancelStatus as ProtestCancel].toLowerCase()}`}
                </span>
                {acoes("protesto", p.id, "Remover o protesto", () => abrirPro(p), !!p.removedAt)}
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  p.protocol && `protocolo ${p.protocol}`,
                  p.protestedOn && `protestado em ${formatIsoDateBr(p.protestedOn)}`,
                  p.amountCents !== null && `valor ${formatBRL(p.amountCents)}`,
                  p.cancelCostCents !== null && `custas ${formatBRL(p.cancelCostCents)}${p.costQuotedOn ? ` (cotadas em ${formatIsoDateBr(p.costQuotedOn)})` : ""}`,
                  `anuência: ${CONSENT_LABELS[p.consentLetter as ConsentLetter].toLowerCase()}`,
                  p.notes,
                ].filter(Boolean).join(" · ")}
              </p>
              <Removido em={p.removedAt} motivo={p.removedReason} />
            </li>
          ))}
        </ul>,
        pro && (
          <Caixa titulo={pro.id ? "Editar protesto" : "Novo protesto"} onCancelar={() => setPro(null)} onSalvar={salvarPro} ocupado={ocupado}>
            {groupId && !pro.id && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px]">O protesto é de</Label>
                <div className="flex gap-4">
                  {(["divida", "grupo"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-sm">
                      <input type="radio" className="accent-primary" checked={pro.escopo === t} onChange={() => setPro({ ...pro, escopo: t })} />
                      {t === "divida" ? "Só esta dívida" : `O grupo inteiro (${groupLabel ?? "grupo"})`}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Cartório</Label>
              <select
                className={SELECT}
                value={String(pro.notary_office_id)}
                onChange={(e) => (e.target.value === "__novo" ? setNovoCartorio({ nome: "", cidade: "", uf: "" }) : setPro({ ...pro, notary_office_id: e.target.value }))}
              >
                <option value="">—</option>
                {listaCartorios.filter((c) => c.ativo || c.id === pro.notary_office_id).map((c) => (
                  <option key={c.id} value={c.id}>{nomeDoCartorio(c.id)}</option>
                ))}
                <option value="__novo">+ Cadastrar cartório…</option>
              </select>
            </label>
            {novoCartorio && (
              <div className="grid gap-2 rounded border p-2 sm:col-span-2 sm:grid-cols-4">
                <Campo className="sm:col-span-2" rotulo="Nome do cartório *" valor={novoCartorio.nome} onChange={(v) => setNovoCartorio({ ...novoCartorio, nome: v })} />
                <Campo rotulo="Cidade" valor={novoCartorio.cidade} onChange={(v) => setNovoCartorio({ ...novoCartorio, cidade: v })} />
                <Campo rotulo="UF" valor={novoCartorio.uf} onChange={(v) => setNovoCartorio({ ...novoCartorio, uf: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) })} />
                <div className="flex gap-2 sm:col-span-4">
                  <Button size="sm" type="button" onClick={criarCartorio} disabled={ocupado}>Cadastrar cartório</Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setNovoCartorio(null)}>Cancelar</Button>
                </div>
              </div>
            )}
            <Campo rotulo="Nº do protocolo / título" valor={String(pro.protocol)} onChange={(v) => setPro({ ...pro, protocol: v })} />
            <Campo rotulo="Data do protesto" type="date" valor={String(pro.protested_on)} onChange={(v) => setPro({ ...pro, protested_on: v })} />
            <Campo rotulo="Valor protestado (R$)" inputMode="decimal" valor={String(pro.amount)} onChange={(v) => setPro({ ...pro, amount: moeda(v) })} />
            <Campo rotulo="Custas para cancelar (R$)" inputMode="decimal" valor={String(pro.cost)} onChange={(v) => setPro({ ...pro, cost: moeda(v) })} />
            <Campo rotulo="Custas cotadas em" type="date" valor={String(pro.cost_quoted_on)} onChange={(v) => setPro({ ...pro, cost_quoted_on: v })} />
            <label className="block">
              <Label className="text-[11px]">Carta de anuência</Label>
              <select className={SELECT} value={String(pro.consent_letter)} onChange={(e) => setPro({ ...pro, consent_letter: e.target.value })}>
                {(Object.keys(CONSENT_LABELS) as ConsentLetter[]).map((k) => (
                  <option key={k} value={k}>{CONSENT_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label className="text-[11px]">Cancelamento do protesto</Label>
              <select className={SELECT} value={String(pro.cancel_status)} onChange={(e) => setPro({ ...pro, cancel_status: e.target.value })}>
                {(Object.keys(PROTEST_CANCEL_LABELS) as ProtestCancel[]).map((k) => (
                  <option key={k} value={k}>{PROTEST_CANCEL_LABELS[k]}</option>
                ))}
              </select>
            </label>
            {pro.cancel_status === "cancelado" && (
              <Campo rotulo="Cancelado em *" type="date" valor={String(pro.cancelled_on)} onChange={(v) => setPro({ ...pro, cancelled_on: v })} />
            )}
            <Campo className="sm:col-span-2" rotulo="Observações" valor={String(pro.notes)} onChange={(v) => setPro({ ...pro, notes: v })} />
            <p className="text-[11px] text-muted-foreground sm:col-span-2">A carta de anuência e o comprovante do cancelamento vão na aba Anexos.</p>
          </Caixa>
        )
      )}

      {secao(
        "Ação judicial",
        () => abrirAca(null),
        visivel(fase2.acoes).length === 0,
        <ul className="space-y-1 text-sm">
          {visivel(fase2.acoes).map((a) => (
            <li key={a.id} className={cn("rounded-md border px-2 py-1.5", a.removedAt && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.processNumber ?? "Processo sem número"}</span>
                <span className={cn("rounded px-1.5 text-[10px]", a.closedOn ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-200")}>
                  {a.closedOn ? `encerrado em ${formatIsoDateBr(a.closedOn)}` : "em curso"}
                </span>
                {acoes("acao_judicial", a.id, "Remover a ação judicial", () => abrirAca(a), !!a.removedAt)}
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  [a.court, a.district].filter(Boolean).join(" — "),
                  a.phase && `fase: ${a.phase}`,
                  a.claimCents !== null && `causa ${formatBRL(a.claimCents)}`,
                  a.lawyerName && `advogado: ${a.lawyerName}`,
                  a.hasFreeze && "bloqueio judicial",
                  a.hasSeizure && "penhora",
                  a.hasSearchAndSeizure && "busca e apreensão",
                  a.notes,
                ].filter(Boolean).join(" · ")}
              </p>
              <Removido em={a.removedAt} motivo={a.removedReason} />
            </li>
          ))}
        </ul>,
        aca && (
          <Caixa titulo={aca.id ? "Editar ação judicial" : "Nova ação judicial"} onCancelar={() => setAca(null)} onSalvar={salvarAca} ocupado={ocupado}>
            <Campo rotulo="Nº do processo" valor={String(aca.process_number)} onChange={(v) => setAca({ ...aca, process_number: v })} />
            <Campo rotulo="Vara" valor={String(aca.court)} onChange={(v) => setAca({ ...aca, court: v })} />
            <Campo rotulo="Comarca" valor={String(aca.district)} onChange={(v) => setAca({ ...aca, district: v })} />
            <Campo rotulo="Fase" valor={String(aca.phase)} onChange={(v) => setAca({ ...aca, phase: v })} placeholder="Ex.: citação, sentença, execução" />
            <Campo rotulo="Valor da causa (R$)" inputMode="decimal" valor={String(aca.claim)} onChange={(v) => setAca({ ...aca, claim: moeda(v) })} />
            <Campo rotulo="Advogado responsável" valor={String(aca.lawyer_name)} onChange={(v) => setAca({ ...aca, lawyer_name: v })} />
            <div className="space-y-1 sm:col-span-2">
              <Marca rotulo="Bloqueio judicial" valor={aca.has_freeze === true} onChange={(v) => setAca({ ...aca, has_freeze: v })} />
              <Marca rotulo="Penhora" valor={aca.has_seizure === true} onChange={(v) => setAca({ ...aca, has_seizure: v })} />
              <Marca rotulo="Busca e apreensão" valor={aca.has_search_and_seizure === true} onChange={(v) => setAca({ ...aca, has_search_and_seizure: v })} />
            </div>
            <Campo rotulo="Encerrado / baixado em" type="date" valor={String(aca.closed_on)} onChange={(v) => setAca({ ...aca, closed_on: v })} />
            <Campo rotulo="Observações" valor={String(aca.notes)} onChange={(v) => setAca({ ...aca, notes: v })} />
          </Caixa>
        )
      )}

      {secao(
        "Notificação extrajudicial",
        () => abrirNot(null),
        visivel(fase2.notificacoes).length === 0,
        <ul className="space-y-1 text-sm">
          {visivel(fase2.notificacoes).map((n) => (
            <li key={n.id} className={cn("rounded-md border px-2 py-1.5", n.removedAt && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="font-medium">Recebida em {formatIsoDateBr(n.receivedOn)}</span>
                {acoes("notificacao", n.id, "Remover a notificação", () => abrirNot(n), !!n.removedAt)}
              </div>
              {n.notes && <p className="text-xs text-muted-foreground">{n.notes}</p>}
              <Removido em={n.removedAt} motivo={n.removedReason} />
            </li>
          ))}
        </ul>,
        not && (
          <Caixa titulo={not.id ? "Editar notificação" : "Nova notificação"} onCancelar={() => setNot(null)} onSalvar={salvarNot} ocupado={ocupado}>
            <Campo rotulo="Recebida em *" type="date" valor={not.received_on} onChange={(v) => setNot({ ...not, received_on: v })} />
            <Campo rotulo="Observações" valor={not.notes} onChange={(v) => setNot({ ...not, notes: v })} />
            <p className="text-[11px] text-muted-foreground sm:col-span-2">O documento da notificação vai na aba Anexos.</p>
          </Caixa>
        )
      )}

      {remover && (
        <RemoverComMotivo
          titulo={remover.titulo}
          aberto
          ocupado={ocupado}
          onFechar={() => setRemover(null)}
          onConfirmar={(motivo) => rodar(() => removerRegistro(debtId, remover.tipo, remover.id, motivo), "Removido (fica no histórico).", () => setRemover(null))}
        />
      )}
    </div>
  );
}
