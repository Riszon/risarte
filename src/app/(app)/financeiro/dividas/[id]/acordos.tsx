"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Handshake, RotateCcw, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr } from "@/lib/dates";
import { CHANNEL_LABELS, PAYMENT_METHOD_LABELS, STATUS_LABELS, centavosDoCampo, type DebtStatus } from "@/lib/finance/dividas";
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_TONE,
  RECOGNITION_LABELS,
  acoesDoAcordo,
  acordoParaOBanco,
  faltaNoAcordo,
  fraseDoImpactoDoAcordo,
  montarParcelas,
  previaDoBanco,
  somaDasParcelas,
  somarMeses,
  type ParcelaDoAcordo,
  type PreviaDoAcordo,
} from "@/lib/finance/dividas-acordos";
import type { ContaDaUnidade } from "@/lib/finance/conta-do-dinheiro";
import type { Acordo, Contato, ParcelaLida, Proposta } from "../dados";
import { decidirAcordo, desfazerAcordo, previaDoAcordo, registrarAcordo, restabelecerDivida } from "../actions";
import { Campo, SELECT, moeda, useAcao } from "./comum";
import { DialogoDePagamento, type TituloParaPagar } from "./pagamento";

// A aba "Acordos" do detalhe da dívida (0408, fase 5): os acordos que cobrem
// esta dívida, as parcelas (que SÃO títulos do Contas a Pagar), e o fluxo
// "Renegociar dívida" do plano (3.2). A conta do impacto é a do banco.

export type Candidata = {
  id: string;
  code: string;
  descricao: string;
  saldoCents: number;
  status: DebtStatus;
  groupId: string | null;
  noFinanceiro: boolean;
};

const SITUACAO_DA_PARCELA: Record<string, string> = {
  aberta: "Em aberto",
  parcial: "Pago em parte",
  paga: "Paga",
  cancelada: "Cancelada",
  renegociada: "Renegociada",
};

const emTexto = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function Acordos({
  divida,
  devedor,
  candidatas,
  acordos,
  propostasAtivas,
  contatos,
  codigos,
  nomes,
  contas,
  hoje,
  podeRenegociar,
  podePagar,
  souAdminMaster,
  meuId,
  abrirNovo,
}: {
  divida: { id: string; code: string; clinicId: string; groupId: string | null };
  devedor: string;
  candidatas: Candidata[];
  acordos: Acordo[];
  propostasAtivas: Proposta[];
  contatos: Contato[];
  codigos: Record<string, string>;
  nomes: Record<string, string>;
  contas: ContaDaUnidade[];
  hoje: string;
  podeRenegociar: boolean;
  podePagar: boolean;
  souAdminMaster: boolean;
  meuId: string;
  abrirNovo: boolean;
}) {
  const { ocupado, rodar } = useAcao();
  // O botão do cabeçalho abre o "Renegociar" — menos quando já há acordo valendo.
  const temVigente = acordos.some((a) => a.situacao === "aguardando_aprovacao" || a.situacao === "em_andamento");
  const [novo, setNovo] = useState<string[] | null>(abrirNovo && podeRenegociar && !temVigente ? [divida.id] : null);
  const [pagando, setPagando] = useState<TituloParaPagar | null>(null);
  const [decidir, setDecidir] = useState<{ acordo: Acordo; aprovar: boolean; motivo: string } | null>(null);
  const [desfazer, setDesfazer] = useState<{ acordo: Acordo; motivo: string } | null>(null);
  const [restabelecer, setRestabelecer] = useState<{ acordo: Acordo; vencimento: string; motivo: string } | null>(null);

  const vigente = acordos.find((a) => a.situacao === "aguardando_aprovacao" || a.situacao === "em_andamento");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <Handshake className="size-4 text-muted-foreground" />
          <p className="flex-1 text-muted-foreground">
            O acordo troca os títulos em aberto da dívida por parcelas novas no Contas a Pagar de {devedor} (conta 5.5.02, fora
            da DRE). O desconto obtido entra como receita financeira; os encargos, como despesa financeira.
          </p>
          {podeRenegociar && !vigente && (
            <Button size="sm" onClick={() => setNovo([divida.id])}>
              <Handshake className="size-4" /> Renegociar dívida
            </Button>
          )}
        </CardContent>
      </Card>

      {acordos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum acordo nesta dívida ainda.</p>}

      {acordos.map((a) => {
        const temPagamento = a.titulos.some((t) => t.link === "acordo" && t.pagoCents > 0);
        const acoes = acoesDoAcordo({
          situacao: a.situacao,
          temPagamento,
          podeRenegociar,
          souAdminMaster,
          registreiEu: a.registradoPor === meuId,
        });
        const parcelas = a.titulos.filter((t) => t.link === "acordo");
        const restabelecido = a.titulos.find((t) => t.link === "restabelecido");
        const pago = parcelas.reduce((x, t) => x + t.pagoCents, 0);
        const aberto = parcelas
          .filter((t) => t.status === "aberta" || t.status === "parcial")
          .reduce((x, t) => x + Math.max(t.valorCents - t.pagoCents, 0), 0);
        return (
          <Card key={a.id}>
            <CardContent className="space-y-3 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    Acordo {a.codigo}
                    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", AGREEMENT_STATUS_TONE[a.situacao])}>
                      {AGREEMENT_STATUS_LABELS[a.situacao]}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    De {formatIsoDateBr(a.data)} · registrado em {formatBrDateTime(a.registradoEm)}
                    {a.registradoPor && nomes[a.registradoPor] ? ` por ${nomes[a.registradoPor]}` : ""}
                    {a.aprovadoPor && ` · aprovado por ${nomes[a.aprovadoPor] ?? "Admin Master"}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Dívidas: {a.dividas.map((x) => codigos[x.debtId] ?? "—").join(", ")}
                    {a.forma ? ` · ${PAYMENT_METHOD_LABELS[a.forma as keyof typeof PAYMENT_METHOD_LABELS] ?? a.forma}` : ""}
                    {a.canal ? ` · negociado por ${CHANNEL_LABELS[a.canal as keyof typeof CHANNEL_LABELS] ?? a.canal}` : ""}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 text-right text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Faltava (S)</dt>
                    <dd className="tabular-nums">{formatBRL(a.baseCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Acordado (T)</dt>
                    <dd className="tabular-nums font-medium">{formatBRL(a.totalCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{a.descontoCents > 0 ? "Desconto" : "Encargos"}</dt>
                    <dd className="tabular-nums">{formatBRL(a.descontoCents || a.encargosCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pago · falta</dt>
                    <dd className="tabular-nums">
                      {formatBRL(pago)} · {formatBRL(aberto)}
                    </dd>
                  </div>
                </dl>
              </div>

              {a.motivo && <p className="rounded bg-muted/40 px-2 py-1 text-xs">{a.motivo}</p>}
              {(a.descontoCents > 0 || a.encargosCents > 0) && (
                <p className="text-xs text-muted-foreground">
                  {a.descontoCents > 0
                    ? `Desconto reconhecido ${RECOGNITION_LABELS[a.reconhecerDesconto]} (conta 4.1.03).`
                    : `Encargos reconhecidos ${RECOGNITION_LABELS[a.reconhecerEncargos]} (conta 4.2.01).`}
                  {a.toleranciaDiasUteis !== null && ` Tolerância deste acordo: ${a.toleranciaDiasUteis} dia(s) útil(eis).`}
                </p>
              )}

              {a.situacao === "aguardando_aprovacao" ? (
                <TabelaDoCombinado parcelas={a.combinado} />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {parcelas.map((t) => (
                    <LinhaDaParcela
                      key={t.id}
                      t={t}
                      hoje={hoje}
                      pagar={podePagar && (t.status === "aberta" || t.status === "parcial") ? () => setPagando(t) : null}
                    />
                  ))}
                  {restabelecido && (
                    <LinhaDaParcela
                      t={restabelecido}
                      hoje={hoje}
                      pagar={
                        podePagar && (restabelecido.status === "aberta" || restabelecido.status === "parcial")
                          ? () => setPagando(restabelecido)
                          : null
                      }
                    />
                  )}
                </ul>
              )}

              {(acoes.aprovar || acoes.desfazer || acoes.restabelecer || acoes.renegociarDeNovo) && (
                <div className="flex flex-wrap gap-2">
                  {acoes.aprovar && (
                    <>
                      <Button size="sm" onClick={() => setDecidir({ acordo: a, aprovar: true, motivo: "" })}>
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDecidir({ acordo: a, aprovar: false, motivo: "" })}>
                        Recusar
                      </Button>
                    </>
                  )}
                  {acoes.renegociarDeNovo && (
                    <Button size="sm" onClick={() => setNovo(a.dividas.map((x) => x.debtId))}>
                      <Handshake className="size-4" /> Renegociar de novo
                    </Button>
                  )}
                  {acoes.restabelecer && (
                    <Button size="sm" variant="outline" onClick={() => setRestabelecer({ acordo: a, vencimento: hoje, motivo: "" })}>
                      <RotateCcw className="size-4" /> Credor restabeleceu a dívida
                    </Button>
                  )}
                  {acoes.desfazer && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDesfazer({ acordo: a, motivo: "" })}>
                      <Undo2 className="size-4" /> Desfazer acordo
                    </Button>
                  )}
                </div>
              )}
              {a.situacao === "aguardando_aprovacao" && !acoes.aprovar && (
                <p className="text-xs text-muted-foreground">
                  {souAdminMaster
                    ? "Você registrou este acordo: outro Admin Master precisa aprovar."
                    : "Esperando a aprovação do Admin Master. Nada foi gerado no Contas a Pagar ainda."}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {novo && (
        <NovoAcordo
          divida={divida}
          devedor={devedor}
          candidatas={candidatas}
          inicial={novo}
          propostasAtivas={propostasAtivas}
          contatos={contatos}
          hoje={hoje}
          onFechar={() => setNovo(null)}
        />
      )}

      <DialogoDePagamento titulo={pagando} onFechar={() => setPagando(null)} contas={contas} clinicId={divida.clinicId} hoje={hoje} />

      <Dialog open={decidir !== null} onOpenChange={(o) => !o && setDecidir(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{decidir?.aprovar ? "Aprovar" : "Recusar"} o acordo {decidir?.acordo.codigo}</DialogTitle>
          </DialogHeader>
          {decidir && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {decidir.aprovar
                  ? `Ao aprovar, os títulos em aberto viram "renegociado" e nascem ${decidir.acordo.parcelas} parcela(s) no Contas a Pagar, total ${formatBRL(decidir.acordo.totalCents)}.`
                  : "Ao recusar, nada é gerado e a dívida volta ao que era. O motivo fica no histórico."}
              </p>
              <Campo rotulo={decidir.aprovar ? "Observação (opcional)" : "Motivo da recusa *"} valor={decidir.motivo} onChange={(v) => setDecidir({ ...decidir, motivo: v })} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDecidir(null)}>Cancelar</Button>
            <Button
              disabled={ocupado}
              variant={decidir?.aprovar ? "default" : "destructive"}
              onClick={() => {
                if (!decidir) return;
                if (!decidir.aprovar && decidir.motivo.trim().length < 5) return toast.error("Escreva o motivo da recusa.");
                rodar(
                  () => decidirAcordo(divida.id, decidir.acordo.id, decidir.aprovar, decidir.motivo),
                  decidir.aprovar ? "Acordo aprovado: as parcelas estão no Contas a Pagar." : "Acordo recusado.",
                  () => setDecidir(null)
                );
              }}
            >
              {decidir?.aprovar ? "Aprovar" : "Recusar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={desfazer !== null} onOpenChange={(o) => !o && setDesfazer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desfazer o acordo {desfazer?.acordo.codigo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Só enquanto nenhuma parcela foi paga. As parcelas são canceladas, o desconto (ou os encargos) sai do resultado e os
            títulos da dívida voltam a ficar em aberto. Tudo fica no histórico.
          </p>
          <Campo rotulo="Motivo *" valor={desfazer?.motivo ?? ""} onChange={(v) => desfazer && setDesfazer({ ...desfazer, motivo: v })} />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDesfazer(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={ocupado}
              onClick={() => {
                if (!desfazer) return;
                if (desfazer.motivo.trim().length < 5) return toast.error("Escreva o motivo (5 letras ou mais).");
                rodar(() => desfazerAcordo(divida.id, desfazer.acordo.id, desfazer.motivo), "Acordo desfeito.", () => setDesfazer(null));
              }}
            >
              Desfazer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restabelecer !== null} onOpenChange={(o) => !o && setRestabelecer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>O credor restabeleceu a dívida ({restabelecer?.acordo.codigo})</DialogTitle>
          </DialogHeader>
          {restabelecer && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Use quando o credor não aceitou o acordo quebrado e voltou a cobrar o saldo. As parcelas em aberto viram
                “renegociado”, nasce um título de{" "}
                <strong>
                  {formatBRL(
                    Math.max(
                      restabelecer.acordo.baseCents -
                        restabelecer.acordo.titulos.filter((t) => t.link === "acordo").reduce((x, t) => x + t.pagoCents, 0),
                      0
                    )
                  )}
                </strong>{" "}
                (o que faltava antes do acordo menos o que foi pago nele) e o desconto reconhecido até aqui é estornado com data
                de hoje.
              </p>
              <label className="block">
                <Label className="text-[11px]">Vencimento do título restabelecido</Label>
                <Input type="date" className="h-9" value={restabelecer.vencimento} onChange={(e) => setRestabelecer({ ...restabelecer, vencimento: e.target.value })} />
              </label>
              <Campo rotulo="O que o credor informou *" valor={restabelecer.motivo} onChange={(v) => setRestabelecer({ ...restabelecer, motivo: v })} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRestabelecer(null)}>Cancelar</Button>
            <Button
              disabled={ocupado}
              onClick={() => {
                if (!restabelecer) return;
                if (restabelecer.motivo.trim().length < 5) return toast.error("Escreva o que o credor informou.");
                rodar(
                  () => restabelecerDivida(divida.id, restabelecer.acordo.id, restabelecer.vencimento, restabelecer.motivo),
                  "Dívida restabelecida: o título novo está no Contas a Pagar.",
                  () => setRestabelecer(null)
                );
              }}
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinhaDaParcela({ t, hoje, pagar }: { t: ParcelaLida; hoje: string; pagar: (() => void) | null }) {
  const vencida = (t.status === "aberta" || t.status === "parcial") && t.vencimento < hoje;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="min-w-0 flex-1 truncate">{t.link === "restabelecido" ? "Dívida restabelecida" : t.descricao}</span>
      <span className={cn("text-xs", vencida ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground")}>
        vence {formatIsoDateBr(t.vencimento)}
      </span>
      <span className="text-xs">{SITUACAO_DA_PARCELA[t.status] ?? t.status}</span>
      <span className="w-36 text-right tabular-nums">
        {formatBRL(t.valorCents)}
        {t.pagoCents > 0 && <span className="block text-xs text-muted-foreground">pago {formatBRL(t.pagoCents)}</span>}
      </span>
      {pagar && (
        <Button size="sm" variant="outline" onClick={pagar}>
          <Wallet className="size-4" /> Registrar pagamento
        </Button>
      )}
    </li>
  );
}

function TabelaDoCombinado({ parcelas }: { parcelas: ParcelaDoAcordo[] }) {
  return (
    <ul className="divide-y rounded-lg border border-dashed">
      {parcelas.map((p, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-1.5">
          <span className="flex-1">{p.entrada ? "Entrada" : `Parcela ${i + 1}`}</span>
          <span className="text-xs text-muted-foreground">vence {formatIsoDateBr(p.vencimento)}</span>
          <span className="w-32 text-right tabular-nums">{formatBRL(p.valorCents)}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------- Renegociar dívida

type Passo = "entra" | "condicoes" | "impacto";

function NovoAcordo({
  divida,
  devedor,
  candidatas,
  inicial,
  propostasAtivas,
  contatos,
  hoje,
  onFechar,
}: {
  divida: { id: string; code: string; clinicId: string; groupId: string | null };
  devedor: string;
  candidatas: Candidata[];
  inicial: string[];
  propostasAtivas: Proposta[];
  contatos: Contato[];
  hoje: string;
  onFechar: () => void;
}) {
  const { ocupado, rodar } = useAcao();
  const [passo, setPasso] = useState<Passo>("entra");
  const [marcadas, setMarcadas] = useState<string[]>(inicial);
  const proposta0 = propostasAtivas[0] ?? null;
  const [propostaId, setPropostaId] = useState<string>(proposta0?.id ?? "");
  const [data, setData] = useState(hoje);
  const [total, setTotal] = useState(proposta0 ? emTexto(proposta0.amountCents) : "");
  const [entrada, setEntrada] = useState(proposta0?.downPaymentCents ? emTexto(proposta0.downPaymentCents) : "");
  const [nParcelas, setNParcelas] = useState(String(proposta0?.installments ?? 1));
  const [primeiro, setPrimeiro] = useState(somarMeses(hoje, 1));
  const [parcelas, setParcelas] = useState<ParcelaDoAcordo[]>([]);
  const [forma, setForma] = useState(proposta0?.method ?? "");
  const [canal, setCanal] = useState("");
  const [contatoId, setContatoId] = useState("");
  const [tolerancia, setTolerancia] = useState("");
  const [obs, setObs] = useState("");
  const [previa, setPrevia] = useState<PreviaDoAcordo | null>(null);
  const [conferindo, setConferindo] = useState(false);

  const saldoMarcado = candidatas.filter((c) => marcadas.includes(c.id)).reduce((x, c) => x + c.saldoCents, 0);
  const totalCents = centavosDoCampo(total);

  const montar = () => {
    const t = centavosDoCampo(total);
    const e = centavosDoCampo(entrada) ?? 0;
    const n = Number(nParcelas);
    if (!t || Number.isNaN(t) || t <= 0) return toast.error("Informe o total do acordo.");
    if (Number.isNaN(e) || e < 0 || e > t) return toast.error("Entrada inválida.");
    if (!Number.isInteger(n) || n < 0 || n > 360 || (n === 0 && e !== t)) return toast.error("Número de parcelas inválido.");
    setParcelas(montarParcelas({ totalCents: t, entradaCents: e, parcelas: n, dataDaEntrada: data, primeiroVencimento: primeiro }));
  };

  const payload = () =>
    acordoParaOBanco({
      dividas: marcadas,
      principal: divida.id,
      data,
      totalCents: totalCents ?? 0,
      parcelas,
      propostaId: propostaId || null,
      forma,
      canal,
      contatoId,
      toleranciaDiasUteis: tolerancia.trim() === "" ? null : Number(tolerancia),
      observacoes: obs,
    });

  const conferir = async () => {
    const falta = faltaNoAcordo({ data, hoje, totalCents: totalCents ?? null, parcelas });
    if (falta) return toast.error(falta);
    setConferindo(true);
    try {
      const r = await previaDoAcordo(payload());
      if (!r.ok) return toast.error(r.error ?? "Não foi possível conferir.");
      setPrevia(previaDoBanco(r.previa));
      setPasso("impacto");
    } finally {
      setConferindo(false);
    }
  };

  const confirmar = () =>
    rodar(
      () => registrarAcordo(divida.id, payload()),
      previa?.pedeAprovacao ? "Acordo registrado: esperando a aprovação do Admin Master." : "Acordo registrado: as parcelas estão no Contas a Pagar.",
      onFechar
    );

  const mudarParcela = (i: number, campo: "vencimento" | "valor", v: string) =>
    setParcelas((ps) =>
      ps.map((p, k) =>
        k !== i ? p : campo === "vencimento" ? { ...p, vencimento: v } : { ...p, valorCents: centavosDoCampo(v) ?? 0 }
      )
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Renegociar dívida — {passo === "entra" ? "1. O que entra" : passo === "condicoes" ? "2. Condições" : "3. Impacto"}</DialogTitle>
        </DialogHeader>

        {passo === "entra" && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Esta dívida, o grupo dela ou outras do mesmo credor e devedor. A base do acordo é o que falta pagar em cada título.
            </p>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {candidatas.map((c) => {
                const bloqueada = !c.noFinanceiro;
                return (
                  <li key={c.id} className={cn("flex items-center gap-2 px-3 py-2", bloqueada && "opacity-60")}>
                    <input
                      type="checkbox"
                      aria-label={`Incluir ${c.code}`}
                      disabled={bloqueada || c.id === divida.id}
                      checked={marcadas.includes(c.id)}
                      onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, c.id] : m.filter((x) => x !== c.id)))}
                    />
                    <span className="font-medium">{c.code}</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {c.descricao}
                      {c.groupId && c.groupId === divida.groupId ? " · mesmo grupo" : ""}
                      {bloqueada ? " · ainda não está no Contas a Pagar" : ""}
                    </span>
                    <span className="text-xs">{STATUS_LABELS[c.status]}</span>
                    <span className="w-28 text-right tabular-nums">{formatBRL(c.saldoCents)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-right text-sm">
              Falta pagar nas escolhidas: <strong className="tabular-nums">{formatBRL(saldoMarcado)}</strong>
            </p>
          </div>
        )}

        {passo === "condicoes" && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <Label className="text-[11px]">Data do acordo *</Label>
                <Input type="date" className="h-9" max={hoje} value={data} onChange={(e) => setData(e.target.value)} />
              </label>
              <Campo rotulo="Total do acordo (R$) *" valor={total} onChange={(v) => setTotal(moeda(v))} inputMode="decimal" />
              <label className="block">
                <Label className="text-[11px]">Proposta usada</Label>
                <select
                  className={SELECT}
                  value={propostaId}
                  onChange={(e) => {
                    setPropostaId(e.target.value);
                    const p = propostasAtivas.find((x) => x.id === e.target.value);
                    if (p) setTotal(emTexto(p.amountCents));
                  }}
                >
                  <option value="">Nenhuma</option>
                  {propostasAtivas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatBRL(p.amountCents)} de {formatIsoDateBr(p.proposedOn)}
                    </option>
                  ))}
                </select>
              </label>
              <Campo rotulo="Entrada (R$)" valor={entrada} onChange={(v) => setEntrada(moeda(v))} inputMode="decimal" />
              <Campo rotulo="Nº de parcelas (fora a entrada)" valor={nParcelas} onChange={setNParcelas} inputMode="numeric" />
              <label className="block">
                <Label className="text-[11px]">1º vencimento das parcelas</Label>
                <Input type="date" className="h-9" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" type="button" onClick={montar}>
                Montar as parcelas
              </Button>
              <span className="text-[11px] text-muted-foreground">Mensais, a última absorve o arredondamento. Dá para editar cada uma.</span>
            </div>
            {parcelas.length > 0 && (
              <div className="space-y-1">
                <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                  {parcelas.map((p, i) => (
                    <li key={i} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-20 text-xs">{p.entrada ? "Entrada" : `Parcela ${parcelas.filter((x, k) => k <= i && !x.entrada).length}`}</span>
                      <Input type="date" className="h-8 w-40" value={p.vencimento} onChange={(e) => mudarParcela(i, "vencimento", e.target.value)} />
                      <Input
                        className="h-8 w-32 text-right"
                        inputMode="decimal"
                        defaultValue={emTexto(p.valorCents)}
                        onBlur={(e) => mudarParcela(i, "valor", e.target.value)}
                      />
                    </li>
                  ))}
                </ul>
                <p className={cn("text-right text-xs", totalCents !== null && somaDasParcelas(parcelas) !== totalCents && "font-medium text-red-700 dark:text-red-300")}>
                  Soma das parcelas: {formatBRL(somaDasParcelas(parcelas))}
                  {totalCents !== null && somaDasParcelas(parcelas) !== totalCents && ` — não fecha com o total (${formatBRL(totalCents)})`}
                </p>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <Label className="text-[11px]">Forma de pagamento</Label>
                <select className={SELECT} value={forma} onChange={(e) => setForma(e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Canal da negociação</Label>
                <select className={SELECT} value={canal} onChange={(e) => setCanal(e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Com quem (contato do credor)</Label>
                <select className={SELECT} value={contatoId} onChange={(e) => setContatoId(e.target.value)}>
                  <option value="">—</option>
                  {contatos.map((c) => (
                    <option key={c.id} value={c.id}>{[c.organization, c.personName].filter(Boolean).join(" · ") || "Contato"}</option>
                  ))}
                </select>
              </label>
              <Campo rotulo="Tolerância para quebra (dias úteis)" valor={tolerancia} onChange={(v) => setTolerancia(v.replace(/\D/g, ""))} placeholder="o da rede" inputMode="numeric" />
              <Campo className="sm:col-span-2" rotulo="Observações" valor={obs} onChange={setObs} />
            </div>
          </div>
        )}

        {passo === "impacto" && previa && (
          <div className="space-y-2 text-sm">
            {previa.acrescentadas.length > 0 && (
              <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Entraram também {previa.acrescentadas.length} dívida(s) do acordo anterior: o saldo é do acordo inteiro.
              </p>
            )}
            <ul className="list-disc space-y-1 pl-5">
              {fraseDoImpactoDoAcordo(previa, devedor).map((l, i) => (
                <li key={i} className={cn(previa.problema && "text-red-700 dark:text-red-300")}>{l}</li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Esta conta é a do banco: é exatamente o que será gravado ao confirmar. Termo do acordo e boletos você anexa depois, na
              aba Anexos.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          {passo !== "entra" && (
            <Button variant="outline" onClick={() => setPasso(passo === "impacto" ? "condicoes" : "entra")}>
              Voltar
            </Button>
          )}
          {passo === "entra" && (
            <Button disabled={marcadas.length === 0} onClick={() => setPasso("condicoes")}>
              Continuar
            </Button>
          )}
          {passo === "condicoes" && (
            <Button disabled={conferindo} onClick={conferir}>
              Conferir o impacto
            </Button>
          )}
          {passo === "impacto" && (
            <Button disabled={ocupado || !!previa?.problema} onClick={confirmar}>
              {previa?.pedeAprovacao ? "Enviar para aprovação" : "Confirmar o acordo"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
