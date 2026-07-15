"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Printer,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateGammaDeck, getGammaStatus } from "./actions";

export type PresentationOptionItem = {
  description: string;
  quantity: number;
  sessionsLabel: string | null;
  minutesLabel: string | null;
  priceLabel: string | null;
};

export type PresentationSessionGroup = {
  procedure: string;
  quantity: number;
  repeatNote: string | null;
  sessions: { label: string; minutesLabel: string | null }[];
};

export type PresentationData = {
  clientName: string;
  clientCode: string | null;
  clinicName: string | null;
  pillarLabel: string | null;
  dateLabel: string;
  diagnosis: string | null;
  objectives: string | null;
  planningNotes: string | null;
  considerations: string[];
  photos: { id: string; url: string; name: string | null }[];
  option: {
    title: string;
    items: PresentationOptionItem[];
    totalLabel: string | null;
    summaryLabel: string | null;
  } | null;
  sessionGroups: PresentationSessionGroup[];
};

// Próximas etapas padrão da Jornada Risarte após a aprovação do plano.
const NEXT_STEPS = [
  "Apresentação e aceite da proposta pelo cliente.",
  "Assinatura dos documentos e confirmação do pagamento.",
  "Agendamento do início do tratamento com a recepção.",
  "Execução das sessões e acompanhamento.",
];

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #apresentacao, #apresentacao * { visibility: visible !important; }
  #apresentacao { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  .no-print { display: none !important; }
  .slide { break-inside: avoid; page-break-inside: avoid; }
}
`;

function Slide({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="slide rounded-lg border bg-card p-6 shadow-sm">
      {title && (
        <h2 className="mb-3 border-b pb-2 text-lg font-semibold text-primary">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

type GammaState =
  | { phase: "idle" }
  | { phase: "choosing" }
  | { phase: "generating" }
  | { phase: "ready"; url: string }
  | { phase: "error"; error: string };

export function PresentationView({
  data,
  clientId,
}: {
  data: PresentationData;
  clientId: string;
}) {
  const router = useRouter();
  const [zoom, setZoom] = useState<number | null>(null);
  const [gamma, setGamma] = useState<GammaState>({ phase: "idle" });
  const [generationId, setGenerationId] = useState<string | null>(null);
  // Fotos que entram no deck do Gamma (padrão: todas).
  const [gammaPhotoIds, setGammaPhotoIds] = useState<string[]>(() =>
    data.photos.map((p) => p.id)
  );

  // Polling do status da geração no Gamma (até completar).
  useEffect(() => {
    if (!generationId) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      const st = await getGammaStatus(generationId);
      if (!active) return;
      if (st.status === "completed" && st.gammaUrl) {
        setGamma({ phase: "ready", url: st.gammaUrl });
        if (timer) clearInterval(timer);
      } else if (st.status === "error") {
        setGamma({
          phase: "error",
          error: "Não foi possível concluir a geração no Gamma.",
        });
        if (timer) clearInterval(timer);
      }
    };
    timer = setInterval(tick, 5000);
    tick();
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [generationId]);

  async function startGamma(photoIds: string[]) {
    setGamma({ phase: "generating" });
    setGenerationId(null);
    const res = await generateGammaDeck(clientId, photoIds);
    if (res.ok) {
      setGenerationId(res.generationId);
    } else {
      setGamma({ phase: "error", error: res.error });
      toast.error(res.error);
    }
  }

  function onGammaClick() {
    // Com fotos, abre o seletor; sem fotos, gera direto.
    if (data.photos.length > 0) setGamma({ phase: "choosing" });
    else startGamma([]);
  }

  function toggleGammaPhoto(id: string) {
    setGammaPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 size-4" />
          Voltar
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onGammaClick}
            disabled={gamma.phase === "generating" || gamma.phase === "choosing"}
          >
            {gamma.phase === "generating" ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 size-4" />
            )}
            Gerar no Gamma
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 size-4" />
            Baixar PDF
          </Button>
        </div>
      </div>

      {gamma.phase !== "idle" && (
        <div className="no-print mb-4 rounded-md border border-gold/40 bg-gold/5 p-3 text-xs">
          {gamma.phase === "choosing" && (
            <div className="space-y-2">
              <p className="font-medium text-primary">
                Fotos que entram no deck do Gamma
              </p>
              <p className="text-muted-foreground">
                As fotos vão automáticas para o deck. Desmarque as que não quiser
                incluir.
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {data.photos.map((p) => {
                  const on = gammaPhotoIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleGammaPhoto(p.id)}
                      aria-pressed={on}
                      className={cn(
                        "relative overflow-hidden rounded border-2 transition",
                        on
                          ? "border-primary"
                          : "border-transparent opacity-40 grayscale"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt={p.name ?? "imagem clínica"}
                        className="aspect-square w-full object-cover"
                      />
                      {on && (
                        <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setGamma({ phase: "idle" })}
                >
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => startGamma(gammaPhotoIds)}>
                  <Sparkles className="mr-1 size-4" />
                  Gerar deck ({gammaPhotoIds.length}{" "}
                  {gammaPhotoIds.length === 1 ? "foto" : "fotos"})
                </Button>
              </div>
            </div>
          )}
          {gamma.phase === "generating" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Gerando a apresentação no Gamma… isso costuma levar até ~1 minuto.
            </p>
          )}
          {gamma.phase === "ready" && (
            <div className="space-y-1.5">
              <a
                href={gamma.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Abrir o deck no Gamma
              </a>
              <p className="text-muted-foreground">
                As <strong>fotos do paciente já vão no deck</strong>. No Gamma
                você pode ajustar o layout e depois{" "}
                <strong>exportar em PPTX ou PDF</strong>.
              </p>
            </div>
          )}
          {gamma.phase === "error" && (
            <p className="text-destructive">{gamma.error}</p>
          )}
        </div>
      )}

      <div className="no-print mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-primary">
          Apresentação ao cliente.
        </span>{" "}
        O plano foi montado pelo Dentista Planner. Você, Consultor Comercial,
        apresenta esta proposta ao cliente — use “Baixar PDF” para enviar ou
        projetar.
      </div>

      <div id="apresentacao" className="space-y-4">
        {/* Capa */}
        <section className="slide rounded-lg border bg-primary p-8 text-primary-foreground shadow-sm">
          <p className="text-sm uppercase tracking-wide opacity-80">
            Plano de Tratamento · Risarte Odontologia
          </p>
          <h1 className="mt-2 text-3xl font-bold">{data.clientName}</h1>
          <p className="mt-1 text-sm opacity-90">
            {data.clientCode && (
              <span className="font-mono">{data.clientCode}</span>
            )}
            {data.clinicName && <> · {data.clinicName}</>}
            <> · {data.dateLabel}</>
          </p>
          {data.pillarLabel && (
            <span className="mt-3 inline-block rounded-full bg-gold px-3 py-1 text-sm font-semibold text-primary">
              Pilar: {data.pillarLabel}
            </span>
          )}
        </section>

        {/* Diagnóstico e condição clínica */}
        {(data.diagnosis || data.considerations.length > 0) && (
          <Slide title="Diagnóstico e condição">
            {data.diagnosis && (
              <p className="whitespace-pre-wrap text-sm">{data.diagnosis}</p>
            )}
            {data.considerations.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {data.considerations.map((c, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Slide>
        )}

        {/* Objetivos do tratamento */}
        {data.objectives && (
          <Slide title="Objetivos do tratamento">
            <p className="whitespace-pre-wrap text-sm">{data.objectives}</p>
          </Slide>
        )}

        {/* Fotos e exames */}
        {data.photos.length > 0 && (
          <Slide title="Imagens e exames">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setZoom(i)}
                  className="overflow-hidden rounded border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.name ?? "imagem clínica"}
                    className="aspect-square w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </Slide>
        )}

        {/* Plano sessão por sessão */}
        {data.sessionGroups.length > 0 && (
          <Slide title="Plano de tratamento — sessão por sessão">
            <div className="space-y-3">
              {data.sessionGroups.map((g, gi) => (
                <div key={gi}>
                  <p className="text-sm font-semibold">
                    {g.quantity > 1 ? `${g.quantity}× ` : ""}
                    {g.procedure}
                  </p>
                  {g.repeatNote && (
                    <p className="text-xs text-muted-foreground">
                      {g.repeatNote}
                    </p>
                  )}
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                    {g.sessions.map((s, si) => (
                      <li key={si}>
                        {s.label}
                        {s.minutesLabel && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · {s.minutesLabel}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Slide>
        )}

        {/* Proposta e investimento */}
        {data.option ? (
          <Slide title="Proposta e investimento">
            <ul className="space-y-2">
              {data.option.items.map((it, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-0"
                >
                  <span className="font-medium">
                    {it.quantity > 1 ? `${it.quantity}× ` : ""}
                    {it.description}
                    {(it.sessionsLabel || it.minutesLabel) && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (
                        {[it.sessionsLabel, it.minutesLabel]
                          .filter(Boolean)
                          .join(" · ")}
                        )
                      </span>
                    )}
                  </span>
                  {it.priceLabel && (
                    <span className="tabular-nums">{it.priceLabel}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
              {data.option.summaryLabel && (
                <span className="text-sm text-muted-foreground">
                  {data.option.summaryLabel}
                </span>
              )}
              {data.option.totalLabel && (
                <span className="text-lg font-bold text-primary">
                  Total: {data.option.totalLabel}
                </span>
              )}
            </div>
          </Slide>
        ) : (
          <Slide title="Proposta e investimento">
            <p className="text-sm text-muted-foreground">
              O plano ainda não tem uma opção aprovada para apresentar.
            </p>
          </Slide>
        )}

        {/* Considerações do planejamento */}
        {data.planningNotes && (
          <Slide title="Considerações do planejamento">
            <p className="whitespace-pre-wrap text-sm">{data.planningNotes}</p>
          </Slide>
        )}

        {/* Próximas etapas */}
        <Slide title="Próximas etapas">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {NEXT_STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Slide>
      </div>

      {/* Ampliar foto (somente na tela) */}
      {zoom !== null && data.photos[zoom] && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setZoom(null)}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.photos[zoom].url}
            alt={data.photos[zoom].name ?? "imagem"}
            className="max-h-[85vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
