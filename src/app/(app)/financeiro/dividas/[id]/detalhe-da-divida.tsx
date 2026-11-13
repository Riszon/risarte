"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, History, MessageSquarePlus, Pencil, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr, formatIsoMonthBr } from "@/lib/dates";
import { formatCnpj } from "@/lib/masks";
import {
  DEBT_TYPE_LABELS,
  MANUAL_STAGES,
  ORIGIN_LABELS,
  PRIORITY_LABELS,
  PRIORITY_REASON_LABELS,
  STATUS_LABELS,
  STATUS_TONE,
  diasEmAtraso,
  etapaPedeMotivo,
  faixaDeAtraso,
  limiteDaNegativacao,
  valorDevido,
  AGING_LABELS,
  selosDaDivida,
  type DebtListRow,
  type ManualStage,
} from "@/lib/finance/dividas";
import type { BaseDasDividas, DetalheDaFase2, Divida } from "../dados";
import { FormularioDaDivida, SELECT_CLASS, formularioDaDivida } from "../formulario-da-divida";
import { excluirDivida, marcarConferida, mudarEtapa } from "../actions";
import { HistoricoDaDivida } from "./historico-da-divida";
import { Restricoes } from "./restricoes";
import { Propostas } from "./propostas";
import { ContatosDaDivida } from "./contatos-da-divida";
import { Anexos } from "./anexos";
import { NoFinanceiro, type PreviaDoFinanceiro } from "./no-financeiro";
import type { TituloDaDivida } from "../dados";
import type { ContaDaUnidade } from "@/lib/finance/conta-do-dinheiro";
import { useAcao } from "./comum";

const ABAS = ["dados", "financeiro", "restricoes", "propostas", "contatos", "anexos", "historico"] as const;
type Aba = (typeof ABAS)[number];
const ROTULO_DA_ABA: Record<Aba, string> = {
  dados: "Dados",
  financeiro: "Contas a Pagar",
  restricoes: "Restrições",
  propostas: "Propostas",
  contatos: "Contatos",
  anexos: "Anexos",
  historico: "Histórico",
};

export function DetalheDaDivida({
  base,
  divida: d,
  linha,
  fase2,
  devidoDoGrupoCents,
  prazos,
  abaInicial,
  excluida,
  nomes,
  hoje,
  podeLancar,
  podeExcluir,
  previa,
  titulos,
  contas,
}: {
  base: BaseDasDividas;
  divida: Divida;
  linha: DebtListRow;
  fase2: DetalheDaFase2;
  devidoDoGrupoCents: number | null;
  prazos: { alertaDaProposta: number; conferencia: number };
  abaInicial: string | null;
  excluida: { em: string; motivo: string } | null;
  nomes: Record<string, string>;
  hoje: string;
  podeLancar: boolean;
  podeExcluir: boolean;
  previa: PreviaDoFinanceiro | null;
  titulos: TituloDaDivida[];
  contas: ContaDaUnidade[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aba, setAba] = useState<Aba>((ABAS as readonly string[]).includes(abaInicial ?? "") ? (abaInicial as Aba) : "dados");
  // Os botões do cabeçalho remontam a aba já com o formulário aberto.
  const [abrir, setAbrir] = useState<{ aba: Aba; n: number } | null>(null);
  const conferir = useAcao();
  const irPara = (a: Aba) => {
    setAba(a);
    setAbrir((x) => ({ aba: a, n: (x?.n ?? 0) + 1 }));
  };
  const selos = selosDaDivida(linha, hoje, prazos);
  const nomesDasPessoas = new Map(Object.entries(nomes));
  const [editando, setEditando] = useState(false);
  const [etapa, setEtapa] = useState<{ para: ManualStage | null; motivo: string } | null>(null);
  const [exclusao, setExclusao] = useState<string | null>(null);

  const devedor = base.devedores.find((c) => c.id === d.clinicId);
  const credor = base.credores.find((c) => c.id === d.supplierId);
  const categoria = base.categorias.find((c) => c.id === d.categoryId);
  const sub = base.categorias.find((c) => c.id === d.subcategoryId);
  const natureza = base.naturezas.find((n) => n.code === d.natureCode);
  const contaEfetiva = d.accountCode ?? (d.origin === "A" ? categoria?.contaAbertura : d.origin === "B" ? categoria?.contaDespesa : null) ?? null;
  const conta = contaEfetiva ? base.contas.find((a) => a.code === contaEfetiva) : null;
  const grupo = base.grupos.find((g) => g.id === d.groupId);
  const contatoDaCobranca = base.contatos.find((c) => c.id === d.collectionContactId);
  const contatos = base.contatos.filter((c) => c.supplierId === d.supplierId);
  const atraso = diasEmAtraso(d.dueDate, hoje);
  const faixa = faixaDeAtraso(atraso);

  const nomesDe = useMemo<Record<string, Map<string, string>>>(
    () => ({
      clinic_id: new Map(base.devedores.map((x) => [x.id, x.nome])),
      supplier_id: new Map(base.credores.map((x) => [x.id, x.nome])),
      category_id: new Map(base.categorias.map((x) => [x.id, x.nome])),
      subcategory_id: new Map(base.categorias.map((x) => [x.id, x.nome])),
      nature_code: new Map(base.naturezas.map((x) => [x.code, x.label])),
      account_code: new Map(base.contas.map((x) => [x.code, `${x.code} · ${x.name}`])),
      group_id: new Map(base.grupos.map((x) => [x.id, `${x.code} · ${x.label}`])),
      collection_contact_id: new Map(base.contatos.map((x) => [x.id, [x.organization, x.personName].filter(Boolean).join(" · ")])),
      owner_user_id: new Map([...base.responsaveis.map((p) => [p.id, p.nome] as [string, string]), ...Object.entries(nomes)]),
      tag_id: new Map(base.etiquetas.map((t) => [t.id, t.nome])),
    }),
    [base, nomes]
  );

  const confirmarEtapa = () => {
    if (!etapa) return;
    if (etapaPedeMotivo(d.manualStage, etapa.para) && etapa.motivo.trim().length < 5) {
      toast.error("Escreva o motivo da mudança de situação.");
      return;
    }
    startTransition(async () => {
      const r = await mudarEtapa(d.id, etapa.para, etapa.motivo);
      if (r.ok) {
        toast.success("Situação atualizada.");
        setEtapa(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  };

  const confirmarExclusao = () => {
    if (exclusao === null) return;
    if (exclusao.trim().length < 5) {
      toast.error("Escreva o motivo da exclusão.");
      return;
    }
    startTransition(async () => {
      const r = await excluirDivida(d.id, exclusao);
      if (r.ok) {
        toast.success("Dívida excluída. Ela continua no histórico.");
        router.push("/financeiro/dividas");
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  };

  const item = (rotulo: string, valor: React.ReactNode) =>
    valor === null || valor === undefined || valor === "" ? null : (
      <div>
        <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
        <dd>{valor}</dd>
      </div>
    );
  const dinheiro = (c: number | null) => (c === null ? null : formatBRL(c));

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {d.code}
            <span className={cn("rounded px-2 py-0.5 text-sm font-medium", STATUS_TONE[d.status])}>{STATUS_LABELS[d.status]}</span>
            {selos.map((x) => (
              <span key={x.codigo} className={cn("rounded px-2 py-0.5 text-sm font-medium", x.tom)}>{x.rotulo}</span>
            ))}
          </h1>
          <p className="text-sm">
            <span className="font-medium">{credor?.nome ?? "Credor"}</span>
            {credor?.documento?.length === 14 && <span className="text-muted-foreground"> · {formatCnpj(credor.documento)}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            Devedor: {devedor?.nome}
            {devedor?.razaoSocial && ` · ${devedor.razaoSocial}`}
            {devedor?.cnpj && ` · ${formatCnpj(devedor.cnpj)}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{formatBRL(valorDevido(linha))}</p>
          <p className="text-xs text-muted-foreground">
            {d.updatedCents !== null ? `atualizado${d.updatedRefDate ? ` em ${formatIsoDateBr(d.updatedRefDate)}` : ""}` : "valor original"}
            {(linha.pagoCents ?? 0) > 0 && ` · já pago ${formatBRL(linha.pagoCents ?? 0)}`}
          </p>
        </div>
      </div>

      {excluida && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Excluída em {formatBrDateTime(excluida.em)}. Motivo: {excluida.motivo}
        </p>
      )}

      {!excluida && (podeLancar || podeExcluir) && (
        <div className="flex flex-wrap gap-2">
          {podeLancar && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                <Pencil className="size-4" /> Editar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEtapa({ para: d.manualStage, motivo: "" })}>
                Mudar situação
              </Button>
              <Button size="sm" variant="outline" onClick={() => irPara("propostas")}>
                <Receipt className="size-4" /> Registrar proposta
              </Button>
              <Button size="sm" variant="outline" onClick={() => irPara("contatos")}>
                <MessageSquarePlus className="size-4" /> Registrar contato
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={conferir.ocupado}
                onClick={() => conferir.rodar(() => marcarConferida(d.id, hoje), "Marcada como conferida hoje.")}
              >
                <CheckCheck className="size-4" /> Conferida hoje
              </Button>
            </>
          )}
          {podeExcluir && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setExclusao("")}>
              <Trash2 className="size-4" /> Excluir
            </Button>
          )}
          <span className="self-center text-[11px] text-muted-foreground">
            {d.lastCheckedOn ? `Última conferência: ${formatIsoDateBr(d.lastCheckedOn)}.` : "Nunca conferida."} Pagamentos: aba Contas a
            Pagar. Renegociar chega numa próxima fase.
          </span>
        </div>
      )}

      <div className="flex gap-1 border-b text-sm">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-1.5", aba === a ? "border-gold font-semibold" : "border-transparent text-muted-foreground")}
          >
            {a === "historico" ? (
              <span className="inline-flex items-center gap-1">
                <History className="size-3.5" /> Histórico
              </span>
            ) : (
              ROTULO_DA_ABA[a]
            )}
          </button>
        ))}
      </div>

      {aba === "dados" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardContent className="py-3">
              <h2 className="mb-2 text-sm font-semibold">Identificação</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {item("Tipo", DEBT_TYPE_LABELS[d.debtType])}
                {item("Contrato / título / nota", d.contractNumber)}
                {item("Parcela", d.installmentLabel)}
                {item("Grupo", grupo ? `${grupo.code} · ${grupo.label}` : null)}
                {item("Dívidas reunidas", d.bundledCount > 1 ? String(d.bundledCount) : null)}
                {item("Descrição", d.description)}
                {item("Assessoria / contato da cobrança", contatoDaCobranca ? [contatoDaCobranca.organization, contatoDaCobranca.personName].filter(Boolean).join(" · ") : null)}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <h2 className="mb-2 text-sm font-semibold">Categorização</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {item("Categoria", categoria?.nome)}
                {item("Subcategoria", sub?.nome)}
                {item("Natureza", natureza?.label)}
                {item(d.accountCode ? "Conta (escolhida na dívida)" : "Conta (da categoria)", conta ? `${conta.code} · ${conta.name}` : contaEfetiva)}
                {item("Dívida ativa", d.taxActiveDebt ? "Tributo inscrito em dívida ativa" : null)}
                {item("Etiquetas", d.tagIds.map((t) => base.etiquetas.find((x) => x.id === t)?.nome).filter(Boolean).join(", "))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <h2 className="mb-2 text-sm font-semibold">Valores</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {item("Valor original", dinheiro(d.originalCents))}
                {item("Valor atualizado", d.updatedCents !== null ? `${formatBRL(d.updatedCents)}${d.updatedRefDate ? ` (em ${formatIsoDateBr(d.updatedRefDate)})` : ""}` : null)}
                {item("Juros", dinheiro(d.interestCents))}
                {item("Multa", dinheiro(d.fineCents))}
                {item("Encargos", dinheiro(d.chargesCents))}
                {item("Taxa do contrato", d.contractRatePercent !== null ? `${String(d.contractRatePercent).replace(".", ",")}% ao mês` : null)}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <h2 className="mb-2 text-sm font-semibold">Datas e origem</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {item("Lançada no sistema", `${formatBrDateTime(d.createdAt)}${d.createdBy && nomes[d.createdBy] ? ` por ${nomes[d.createdBy]}` : ""}`)}
                {item("Última alteração", d.updatedAt !== d.createdAt ? `${formatBrDateTime(d.updatedAt)}${d.updatedBy && nomes[d.updatedBy] ? ` por ${nomes[d.updatedBy]}` : ""}` : null)}
                {item("Emissão / contratação", d.issueDate ? formatIsoDateBr(d.issueDate) : null)}
                {item("Competência", d.accrualMonth ? formatIsoMonthBr(d.accrualMonth) : null)}
                {item("Vencimento original", formatIsoDateBr(d.dueDate))}
                {item("Atraso", atraso > 0 ? `${atraso} dia${atraso === 1 ? "" : "s"}${faixa ? ` (${AGING_LABELS[faixa]})` : ""}` : "Ainda não venceu")}
                {item("Limite de 5 anos da negativação (informativo)", formatIsoDateBr(limiteDaNegativacao(d.dueDate)))}
                {item("Origem do lançamento", ORIGIN_LABELS[d.origin])}
                {item("Justificativa da origem", d.originOverrideReason)}
                {item("No Contas a Pagar", d.financeSyncedAt ? `títulos gerados em ${formatBrDateTime(d.financeSyncedAt)}` : "ainda não (a geração dos títulos chega na fase 3)")}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <h2 className="mb-2 text-sm font-semibold">Garantias</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {item("Sócio avalista", d.hasGuarantor ? d.guarantorName ?? "sim" : "não")}
                {item("Cessão de recebíveis de cartão", d.receivablesAssignment ? "sim" : null)}
                {item("Garantia real", d.realGuarantee)}
                {item("Observações", d.guaranteeNotes)}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <h2 className="mb-2 text-sm font-semibold">Gestão</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {item("Prioridade", d.priority ? PRIORITY_LABELS[d.priority] : null)}
                {item("Motivos", d.priorityReasons.map((m) => PRIORITY_REASON_LABELS[m]).join("; "))}
                {item("Responsável", d.ownerUserId ? (nomes[d.ownerUserId] ?? nomesDe.owner_user_id.get(d.ownerUserId) ?? "—") : null)}
                {item("Próxima ação", d.nextAction ? `${d.nextAction}${d.nextActionOn ? ` — ${formatIsoDateBr(d.nextActionOn)}` : ""}` : null)}
                {item("Situação marcada à mão", d.manualStage ? `${STATUS_LABELS[d.manualStage]}${d.stageReason ? ` — ${d.stageReason}` : ""}` : null)}
                {item("Observações", d.notes)}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {!fase2.ok && aba !== "dados" && aba !== "historico" && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Esta parte precisa da migração 0405, que ainda não foi aplicada neste banco.
        </p>
      )}

      {aba === "financeiro" && (
        <NoFinanceiro
          debtId={d.id}
          clinicId={d.clinicId}
          devedor={base.devedores.find((u) => u.id === d.clinicId)?.nome ?? "a unidade"}
          origem={d.origin}
          alvo={{ fornecedorId: d.supplierId, vencimento: d.dueDate, valorCents: d.updatedCents ?? d.originalCents, contrato: d.contractNumber }}
          previa={previa}
          titulos={titulos}
          contas={contas}
          hoje={hoje}
          podeLancar={podeLancar && !excluida}
        />
      )}

      {aba === "restricoes" && fase2.ok && (
        <Restricoes
          debtId={d.id}
          groupId={d.groupId}
          groupLabel={grupo ? `${grupo.code} · ${grupo.label}` : null}
          fase2={fase2}
          cartorios={base.cartorios}
          podeLancar={podeLancar && !excluida}
        />
      )}

      {aba === "propostas" && fase2.ok && (
        <Propostas
          key={`p${abrir?.aba === "propostas" ? abrir.n : 0}`}
          debtId={d.id}
          groupId={d.groupId}
          groupLabel={grupo ? `${grupo.code} · ${grupo.label}` : null}
          devidoCents={valorDevido(linha)}
          devidoDoGrupoCents={devidoDoGrupoCents}
          propostas={fase2.propostas}
          hoje={hoje}
          podeLancar={podeLancar && !excluida}
          abrirNova={abrir?.aba === "propostas"}
        />
      )}

      {aba === "contatos" && fase2.ok && (
        <ContatosDaDivida
          key={`c${abrir?.aba === "contatos" ? abrir.n : 0}`}
          debtId={d.id}
          credorNome={credor?.nome ?? "este credor"}
          contatosDoCredor={contatos}
          feitos={fase2.contatos}
          nomes={nomesDasPessoas}
          podeLancar={podeLancar && !excluida}
          abrirNovo={abrir?.aba === "contatos"}
        />
      )}

      {aba === "anexos" && fase2.ok && (
        <Anexos debtId={d.id} anexos={fase2.anexos} nomes={nomesDasPessoas} podeLancar={podeLancar && !excluida} />
      )}

      {aba === "historico" && (
        <Card>
          <CardContent className="py-2">
            <HistoricoDaDivida debtId={d.id} nomesDe={nomesDe} />
          </CardContent>
        </Card>
      )}

      {editando && (
        <FormularioDaDivida base={base} inicial={formularioDaDivida(d)} aberto={editando} onFechar={() => setEditando(false)} jaNoFinanceiro={!!d.financeSyncedAt} />
      )}

      <Dialog open={etapa !== null} onOpenChange={(o) => !o && setEtapa(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mudar a situação</DialogTitle>
          </DialogHeader>
          {etapa && (
            <div className="space-y-2 text-sm">
              <label className="block">
                <Label className="text-[11px]">Situação</Label>
                <select
                  className={SELECT_CLASS}
                  value={etapa.para ?? ""}
                  onChange={(e) => setEtapa({ ...etapa, para: (e.target.value || null) as ManualStage | null })}
                >
                  <option value="">Pelo vencimento (a vencer / em atraso / inadimplente)</option>
                  {MANUAL_STAGES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Motivo{etapaPedeMotivo(d.manualStage, etapa.para) ? " *" : ""}</Label>
                <Input className="h-9" value={etapa.motivo} onChange={(e) => setEtapa({ ...etapa, motivo: e.target.value })} />
              </label>
              <p className="text-[11px] text-muted-foreground">
                “Em negociação” é marcado à mão. Contestada, judicial e baixada pedem motivo, ao entrar e ao sair.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEtapa(null)}>Cancelar</Button>
            <Button onClick={confirmarEtapa} disabled={isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exclusao !== null} onOpenChange={(o) => !o && setExclusao(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir {d.code}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A dívida sai da lista, mas nada se apaga: ela continua no banco e no histórico, com quem excluiu, quando e o motivo.
          </p>
          <label className="block text-sm">
            <Label className="text-[11px]">Motivo *</Label>
            <Input className="h-9" value={exclusao ?? ""} onChange={(e) => setExclusao(e.target.value)} />
          </label>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setExclusao(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarExclusao} disabled={isPending}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
