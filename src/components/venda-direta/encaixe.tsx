"use client";

// VD3-4 — "Atender agora": o ENCAIXE criado na própria janela do caixa
// (decisões A1–A4, docs/comercial/VENDA-DIRETA-V3-PLANO.md §9). Avaliação ou
// Urgência, o profissional da unidade, 30 min, a partir do próximo intervalo
// de 5 minutos. Sem sala: quem atende escolhe a sala ao chamar (A4).

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  atenderAgora,
  dadosDoEncaixe,
  type ProfissionalDoEncaixe,
  type TipoDoEncaixe,
} from "@/app/(app)/comercial/venda-direta/caixa-actions";

const TIPOS: { valor: TipoDoEncaixe; rotulo: string }[] = [
  { valor: "evaluation", rotulo: "Avaliação" },
  { valor: "urgency", rotulo: "Urgência" },
];
const DURACOES = [15, 30, 45, 60];

type Dados = {
  podeAgendar: boolean;
  faltaNoCadastro: string[];
  profissionais: Record<TipoDoEncaixe, ProfissionalDoEncaixe[]>;
};

export function AtenderAgora({
  clientId,
  aoCriar,
  aoFechar,
}: {
  clientId: string;
  /** O encaixe nasceu: o caixa relê e já escolhe este atendimento. */
  aoCriar: (appointmentId: string) => Promise<void>;
  aoFechar?: () => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDoEncaixe>("evaluation");
  const [quem, setQuem] = useState("");
  const [duracao, setDuracao] = useState(30);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    dadosDoEncaixe(clientId)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setDados(r);
        else setErro(r.error);
      })
      .catch(() => vivo && setErro("Não foi possível abrir o encaixe."));
    return () => {
      vivo = false;
    };
  }, [clientId]);

  const lista = dados?.profissionais[tipo] ?? [];
  // O profissional escolhido some da lista quando troca o tipo: escolhe de novo.
  const escolhido = lista.some((p) => p.userId === quem) ? quem : (lista.length === 1 ? lista[0].userId : "");

  function criar() {
    if (!escolhido) return;
    startTransition(async () => {
      const r = await atenderAgora({ clientId, providerUserId: escolhido, tipo, duracao });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.aviso) toast.warning(r.aviso);
      toast.success("Encaixe criado. A sala é escolhida por quem atender, ao chamar.");
      await aoCriar(r.appointmentId);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Zap className="size-4 text-primary" />
        Atender agora (encaixe)
      </p>
      {erro ? (
        <p className="text-xs text-rose-700">{erro}</p>
      ) : !dados ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Lendo a equipe…
        </p>
      ) : !dados.podeAgendar ? (
        <p className="text-xs text-muted-foreground">
          Quem cria o encaixe é a Recepção ou a SDR (quem agenda na Agenda).
        </p>
      ) : dados.faltaNoCadastro.length > 0 ? (
        // A3: a regra de sempre — cadastro incompleto não é agendado.
        <div className="space-y-1.5 text-xs">
          <p className="text-rose-800">
            Complete o cadastro antes de agendar. Falta: {dados.faltaNoCadastro.join(", ")}.
          </p>
          <Link
            href={`/prontuarios/${clientId}?aba=cadastro&editar=1`}
            className="inline-flex h-8 items-center rounded-md border bg-background px-2.5 font-medium hover:bg-muted"
          >
            Completar cadastro
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo do encaixe">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                type="button"
                role="radio"
                aria-checked={tipo === t.valor}
                onClick={() => setTipo(t.valor)}
                className={cn(
                  "h-8 rounded-lg border px-3 text-sm",
                  tipo === t.valor ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                )}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          {lista.length === 0 ? (
            <p className="text-xs text-rose-800">
              Nenhum profissional desta unidade atende {tipo === "urgency" ? "Urgência" : "Avaliação"}.
            </p>
          ) : (
            <select
              aria-label="Profissional que vai atender"
              value={escolhido}
              onChange={(e) => setQuem(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="">Quem vai atender…</option>
              {lista.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.nome}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Duração:</span>
            {DURACOES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuracao(d)}
                className={cn(
                  "h-7 rounded-md border px-2",
                  duracao === d ? "border-primary bg-primary/10 font-medium text-foreground" : "bg-background hover:bg-muted"
                )}
              >
                {d} min
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Começa agora (o próximo horário de 5 em 5 min), por cima da agenda. Sem sala:
            quem atender escolhe a sala ao chamar.
          </p>
          <div className="flex gap-2">
            {aoFechar && (
              <Button variant="outline" size="sm" disabled={isPending} onClick={aoFechar}>
                Voltar
              </Button>
            )}
            <Button size="sm" className="flex-1" disabled={!escolhido || isPending} onClick={criar}>
              {isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Criar o encaixe e continuar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
