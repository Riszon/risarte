"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { METHODOLOGY_PILLARS, PILLAR_LABELS } from "@/lib/journey";
import { formatBrDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  ROTULO_DA_SUGESTAO,
  type SituacaoDaSugestao,
} from "@/lib/sugestao-de-procedimento";
import {
  answerProcedureSuggestion,
  approveProcedureSuggestion,
  askProcedureSuggestionInfo,
  rejectProcedureSuggestion,
  suggestProcedure,
  type ProcedureInput,
} from "./actions";

export type MensagemDaSugestao = {
  kind: "pergunta" | "resposta" | "recusa" | "aprovacao";
  body: string;
  autor: string | null;
  em: string;
};

export type SugestaoNaTela = {
  id: string;
  code: string;
  name: string;
  specialty: string | null;
  pillar: string | null;
  sessions: number;
  totalMinutes: number | null;
  justification: string;
  status: SituacaoDaSugestao;
  proponente: string | null;
  souEu: boolean;
  criadaEm: string;
  mensagens: MensagemDaSugestao[];
};

const TOM: Record<SituacaoDaSugestao, string> = {
  enviada: "border-primary/40 bg-primary/10 text-primary",
  precisa_info: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  aprovada: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  recusada: "border-border bg-muted text-muted-foreground",
};

const ROTULO_DA_MENSAGEM: Record<MensagemDaSugestao["kind"], string> = {
  pergunta: "A rede perguntou",
  resposta: "Resposta",
  recusa: "Recusada",
  aprovacao: "Aprovada",
};

type Campos = {
  name: string;
  specialty: string;
  pillar: string;
  sessions: string;
  totalMinutes: string;
  justification: string;
};

const VAZIO: Campos = { name: "", specialty: "", pillar: "", sessions: "1", totalMinutes: "", justification: "" };

/** Os campos da sugestão — os mesmos no sugerir e no responder. */
function CamposDaSugestao({
  valor,
  aoMudar,
  especialidades,
}: {
  valor: Campos;
  aoMudar: (p: Partial<Campos>) => void;
  especialidades: string[];
}) {
  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        <Label className="text-[11px]">Nome do procedimento *</Label>
        <Input value={valor.name} onChange={(e) => aoMudar({ name: e.target.value })} placeholder="Ex.: Lente de contato dental" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <Label className="text-[11px]">Especialidade</Label>
          <select
            value={valor.specialty}
            onChange={(e) => aoMudar({ specialty: e.target.value })}
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— sem especialidade —</option>
            {especialidades.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label className="text-[11px]">Pilar da Metodologia</Label>
          <select
            value={valor.pillar}
            onChange={(e) => aoMudar({ pillar: e.target.value })}
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— sem pilar —</option>
            {METHODOLOGY_PILLARS.map((p) => (
              <option key={p} value={p}>{PILLAR_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label className="text-[11px]">Quantidade de sessões *</Label>
          <Input value={valor.sessions} onChange={(e) => aoMudar({ sessions: e.target.value })} inputMode="numeric" />
        </label>
        <label className="block">
          <Label className="text-[11px]">Tempo total do tratamento (min)</Label>
          <Input value={valor.totalMinutes} onChange={(e) => aoMudar({ totalMinutes: e.target.value })} inputMode="numeric" placeholder="Ex.: 120" />
        </label>
      </div>
      <label className="block">
        <Label className="text-[11px]">Por que incluir na rede? *</Label>
        <textarea
          value={valor.justification}
          onChange={(e) => aoMudar({ justification: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          placeholder="Para que casos, por que nenhum procedimento do catálogo serve…"
        />
      </label>
    </div>
  );
}

/**
 * SUGERIR UM PROCEDIMENTO À REDE (relato OC-00067). O Planner não cria
 * procedimento nem item livre no orçamento: quando o catálogo não tem o que o
 * caso pede, ele sugere, e o Admin Master decide.
 */
export function BotaoSugerirProcedimento({
  especialidades,
  rotulo = "Sugerir novo procedimento",
  variante = "outline",
}: {
  especialidades: string[];
  rotulo?: string;
  variante?: "outline" | "link";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [campos, setCampos] = useState<Campos>(VAZIO);

  function enviar() {
    startTransition(async () => {
      const r = await suggestProcedure(campos);
      if (r.ok) {
        toast.success(`Sugestão ${r.code ?? ""} enviada à rede.`);
        setAberto(false);
        setCampos(VAZIO);
        router.refresh();
      } else toast.error(r.error ?? "Não foi possível enviar.");
    });
  }

  return (
    <>
      {variante === "link" ? (
        <button type="button" onClick={() => setAberto(true)} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
          {rotulo}
        </button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
          <Lightbulb className="mr-1 size-4" />
          {rotulo}
        </Button>
      )}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sugerir novo procedimento</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            O catálogo é da rede: o Admin Master recebe a sugestão, pode pedir
            mais informações, e, se aprovar, o procedimento entra no catálogo
            (com preço e comissão definidos pela rede) e você é avisado.
          </p>
          <CamposDaSugestao valor={campos} aoMudar={(p) => setCampos((c) => ({ ...c, ...p }))} especialidades={especialidades} />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button disabled={isPending} onClick={enviar}>Enviar sugestão</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A lista: o Planner vê as suas; o Admin Master, todas — e decide. */
export function SugestoesDeProcedimento({
  sugestoes,
  isAdmin,
  podeSugerir,
  especialidades,
}: {
  sugestoes: SugestaoNaTela[];
  isAdmin: boolean;
  podeSugerir: boolean;
  especialidades: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [respondendo, setRespondendo] = useState<SugestaoNaTela | null>(null);
  const [resposta, setResposta] = useState("");
  const [camposResposta, setCamposResposta] = useState<Campos>(VAZIO);
  const [perguntando, setPerguntando] = useState<SugestaoNaTela | null>(null);
  const [recusando, setRecusando] = useState<SugestaoNaTela | null>(null);
  const [texto, setTexto] = useState("");
  const [aprovando, setAprovando] = useState<SugestaoNaTela | null>(null);
  const [preco, setPreco] = useState({ defaultPrice: "", minPrice: "", maxPrice: "", commissionPercent: "", commissionFixed: "", tussCode: "" });

  const abertas = sugestoes.filter((s) => s.status === "enviada" || s.status === "precisa_info");
  const fechadas = sugestoes.filter((s) => s.status === "aprovada" || s.status === "recusada");
  if (!podeSugerir && !isAdmin) return null;
  if (sugestoes.length === 0 && !podeSugerir) return null;

  function feito(r: { ok: boolean; error?: string }, ok: string, depois: () => void) {
    if (r.ok) {
      toast.success(ok);
      depois();
      router.refresh();
    } else toast.error(r.error ?? "Algo deu errado.");
  }

  function aprovar() {
    if (!aprovando) return;
    const s = aprovando;
    const input: ProcedureInput = {
      name: s.name,
      tussCode: preco.tussCode,
      specialty: s.specialty ?? "",
      pillar: s.pillar ?? "",
      defaultPrice: preco.defaultPrice,
      minPrice: preco.minPrice,
      maxPrice: preco.maxPrice,
      commissionPercent: preco.commissionPercent,
      commissionFixed: preco.commissionFixed,
      estimatedMinutes: s.totalMinutes ? String(s.totalMinutes) : "",
      directSale: false,
      directSaleReception: false,
      directSaleSdr: false,
    };
    startTransition(async () => {
      feito(await approveProcedureSuggestion(s.id, input), `${s.name} entrou no catálogo.`, () => setAprovando(null));
    });
  }

  function Cartao({ s }: { s: SugestaoNaTela }) {
    return (
      <li className="space-y-1.5 rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
          <span className="font-medium">{s.name}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", TOM[s.status])}>
            {ROTULO_DA_SUGESTAO[s.status]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {[s.specialty, s.pillar ? PILLAR_LABELS[s.pillar as keyof typeof PILLAR_LABELS] : null,
            `${s.sessions} ${s.sessions === 1 ? "sessão" : "sessões"}`,
            s.totalMinutes ? `${s.totalMinutes} min` : null,
            isAdmin && s.proponente ? `por ${s.proponente}` : null,
            formatBrDateTime(s.criadaEm)].filter(Boolean).join(" · ")}
        </p>
        <p className="text-xs">{s.justification}</p>
        {s.mensagens.length > 0 && (
          <ul className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
            {s.mensagens.map((m, i) => (
              <li key={i}>
                <strong>{ROTULO_DA_MENSAGEM[m.kind]}</strong>
                {m.autor ? ` (${m.autor})` : ""}: {m.body}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {isAdmin && (s.status === "enviada" || s.status === "precisa_info") && (
            <>
              <Button size="sm" onClick={() => { setAprovando(s); setPreco({ defaultPrice: "", minPrice: "", maxPrice: "", commissionPercent: "", commissionFixed: "", tussCode: "" }); }}>
                Aprovar e cadastrar
              </Button>
              {s.status === "enviada" && (
                <Button size="sm" variant="outline" onClick={() => { setPerguntando(s); setTexto(""); }}>
                  Pedir mais informações
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setRecusando(s); setTexto(""); }}>
                Recusar
              </Button>
            </>
          )}
          {s.souEu && s.status === "precisa_info" && (
            <Button
              size="sm"
              onClick={() => {
                setRespondendo(s);
                setResposta("");
                setCamposResposta({
                  name: s.name,
                  specialty: s.specialty ?? "",
                  pillar: s.pillar ?? "",
                  sessions: String(s.sessions),
                  totalMinutes: s.totalMinutes ? String(s.totalMinutes) : "",
                  justification: s.justification,
                });
              }}
            >
              Responder à rede
            </Button>
          )}
        </div>
      </li>
    );
  }

  return (
    <section id="sugestoes" className="space-y-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            {isAdmin ? "Sugestões de novos procedimentos" : "Minhas sugestões de procedimento"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isAdmin
              ? "O Centro de Planejamento sugere o que falta no catálogo. Aprovar cadastra o procedimento (você define preço e comissão) e as sessões sugeridas viram o protocolo."
              : "Não achou o procedimento no catálogo? Sugira à rede — o Admin Master decide e você é avisado."}
          </p>
        </div>
        {podeSugerir && <BotaoSugerirProcedimento especialidades={especialidades} />}
      </div>

      {abertas.length === 0 && fechadas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma sugestão por enquanto.</p>
      ) : (
        <ul className="space-y-2">
          {abertas.map((s) => <Cartao key={s.id} s={s} />)}
          {fechadas.slice(0, 10).map((s) => <Cartao key={s.id} s={s} />)}
        </ul>
      )}

      {/* Pedir mais informações */}
      <Dialog open={perguntando !== null} onOpenChange={(o) => !o && setPerguntando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Pedir mais informações</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{perguntando?.code} · {perguntando?.name}</p>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm" placeholder="O que falta saber?" />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPerguntando(null)}>Cancelar</Button>
            <Button disabled={isPending} onClick={() => perguntando && startTransition(async () => feito(await askProcedureSuggestionInfo(perguntando.id, texto), "Pergunta enviada.", () => setPerguntando(null)))}>
              Enviar pergunta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recusar */}
      <Dialog open={recusando !== null} onOpenChange={(o) => !o && setRecusando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Recusar a sugestão</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{recusando?.code} · {recusando?.name}</p>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm" placeholder="Motivo (quem sugeriu recebe)" />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRecusando(null)}>Cancelar</Button>
            <Button disabled={isPending} onClick={() => recusando && startTransition(async () => feito(await rejectProcedureSuggestion(recusando.id, texto), "Sugestão recusada.", () => setRecusando(null)))}>
              Recusar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Responder (o Planner pode ajustar a sugestão junto) */}
      <Dialog open={respondendo !== null} onOpenChange={(o) => !o && setRespondendo(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Responder à rede</DialogTitle></DialogHeader>
          <label className="block">
            <Label className="text-[11px]">Sua resposta *</Label>
            <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm" />
          </label>
          <p className="text-[11px] text-muted-foreground">Se precisar, ajuste a sugestão abaixo — ela volta para a rede assim.</p>
          <CamposDaSugestao valor={camposResposta} aoMudar={(p) => setCamposResposta((c) => ({ ...c, ...p }))} especialidades={especialidades} />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRespondendo(null)}>Cancelar</Button>
            <Button disabled={isPending} onClick={() => respondendo && startTransition(async () => feito(await answerProcedureSuggestion(respondendo.id, resposta, camposResposta), "Resposta enviada.", () => setRespondendo(null)))}>
              Enviar resposta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aprovar e cadastrar */}
      <Dialog open={aprovando !== null} onOpenChange={(o) => !o && setAprovando(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Aprovar e cadastrar no catálogo</DialogTitle></DialogHeader>
          {aprovando && (
            <div className="space-y-2 text-sm">
              <p className="rounded-lg bg-muted/40 p-2 text-xs">
                <strong>{aprovando.name}</strong>
                {aprovando.specialty ? ` · ${aprovando.specialty}` : ""}
                {` · ${aprovando.sessions} ${aprovando.sessions === 1 ? "sessão" : "sessões"}`}
                {aprovando.totalMinutes ? ` · ${aprovando.totalMinutes} min` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Complete o que é da rede. As sessões sugeridas viram o protocolo
                do procedimento (dá para ajustar depois no relógio).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block"><Label className="text-[11px]">Preço padrão (R$) *</Label><Input value={preco.defaultPrice} onChange={(e) => setPreco((p) => ({ ...p, defaultPrice: e.target.value }))} inputMode="decimal" placeholder="0,00" /></label>
                <label className="block"><Label className="text-[11px]">Código TUSS</Label><Input value={preco.tussCode} onChange={(e) => setPreco((p) => ({ ...p, tussCode: e.target.value }))} /></label>
                <label className="block"><Label className="text-[11px]">Preço mínimo (R$)</Label><Input value={preco.minPrice} onChange={(e) => setPreco((p) => ({ ...p, minPrice: e.target.value }))} inputMode="decimal" placeholder="(opcional)" /></label>
                <label className="block"><Label className="text-[11px]">Preço máximo (R$)</Label><Input value={preco.maxPrice} onChange={(e) => setPreco((p) => ({ ...p, maxPrice: e.target.value }))} inputMode="decimal" placeholder="(opcional)" /></label>
                <label className="block"><Label className="text-[11px]">Comissão (%)</Label><Input value={preco.commissionPercent} onChange={(e) => setPreco((p) => ({ ...p, commissionPercent: e.target.value }))} inputMode="decimal" /></label>
                <label className="block"><Label className="text-[11px]">Comissão fixa (R$)</Label><Input value={preco.commissionFixed} onChange={(e) => setPreco((p) => ({ ...p, commissionFixed: e.target.value }))} inputMode="decimal" placeholder="(opcional)" /></label>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAprovando(null)}>Cancelar</Button>
            <Button disabled={isPending || !preco.defaultPrice.trim()} onClick={aprovar}>
              Aprovar e cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
