"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Play,
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

// PDF: um slide por página, sem bordas/sombras de tela.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #apresentacao, #apresentacao * { visibility: visible !important; }
  #apresentacao { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  .no-print { display: none !important; }
  .slide {
    break-inside: avoid; page-break-inside: avoid; page-break-after: always;
    border: none !important; box-shadow: none !important;
  }
  .slide:last-child { page-break-after: auto; }
}
`;

// Capa 2.0 — bloco navy com faixa dourada da marca.
function CoverSlide({
  data,
  present,
}: {
  data: PresentationData;
  present?: boolean;
}) {
  return (
    <section
      className={cn(
        "slide relative flex flex-col justify-center overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-sm",
        present ? "h-full p-10 sm:p-16" : "p-8 sm:p-12"
      )}
    >
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gold" />
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
        Risarte Odontologia
      </p>
      <p className="mt-6 text-sm uppercase tracking-wide opacity-70">
        Plano de Tratamento
      </p>
      <h1
        className={cn(
          "mt-1 font-bold",
          present ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"
        )}
      >
        {data.clientName}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-90">
        {data.clientCode && (
          <span className="font-mono">{data.clientCode}</span>
        )}
        {data.clinicName && <span>· {data.clinicName}</span>}
        <span>· {data.dateLabel}</span>
      </div>
      {data.pillarLabel && (
        <span className="mt-6 inline-block w-fit rounded-full bg-gold px-3 py-1 text-sm font-semibold text-primary">
          Pilar da Metodologia · {data.pillarLabel}
        </span>
      )}
    </section>
  );
}

// Moldura padrão de cada slide: título com acento dourado + rodapé com marca,
// paciente e numeração. Em modo apresentação ocupa a altura toda e o conteúdo
// ROLA dentro do slide (não corta blocos longos).
function SlideShell({
  index,
  total,
  title,
  clientName,
  present,
  children,
}: {
  index: number;
  total: number;
  title: string;
  clientName: string;
  present?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "slide relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm",
        present && "h-full"
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-6 pb-3 pt-5">
        <span className="h-5 w-1 shrink-0 rounded bg-gold" />
        <h2
          className={cn(
            "font-semibold text-primary",
            present ? "text-2xl" : "text-lg"
          )}
        >
          {title}
        </h2>
      </div>
      <div
        className={cn(
          "px-6 py-4",
          present && "min-h-0 flex-1 overflow-auto text-base sm:text-lg"
        )}
      >
        {children}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t px-6 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="font-semibold text-primary/70">
          Risarte Odontologia
        </span>
        <span className="min-w-0 truncate">{clientName}</span>
        <span className="tabular-nums">
          {index + 1} / {total}
        </span>
      </div>
    </section>
  );
}

type GammaState =
  | { phase: "idle" }
  | { phase: "choosing" }
  | { phase: "generating" }
  | { phase: "ready"; url: string }
  | { phase: "error"; error: string };

type SlideDef = {
  key: string;
  title: string;
  cover?: boolean;
  body?: React.ReactNode;
};

// Grade de miniaturas com seleção (usada para escolher fotos do Gamma e da
// apresentação).
function PhotoPicker({
  photos,
  selected,
  onToggle,
}: {
  photos: PresentationData["photos"];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {photos.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            aria-pressed={on}
            className={cn(
              "relative overflow-hidden rounded border-2 transition",
              on ? "border-primary" : "border-transparent opacity-40 grayscale"
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
  );
}

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
  // Modo apresentação (tela cheia, um slide por vez).
  const [presenting, setPresenting] = useState(false);
  const [presentSetup, setPresentSetup] = useState(false);
  const [current, setCurrent] = useState(0);
  // Fotos que aparecem na apresentação (padrão: todas; uma por slide).
  const [presentPhotoIds, setPresentPhotoIds] = useState<string[]>(() =>
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

  function togglePresentPhoto(id: string) {
    setPresentPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // Monta os slides. `mode` decide as fotos: "present" = uma foto por slide
  // (só as escolhidas); "scroll" = uma grade com todas (tela e PDF).
  function buildSlides(mode: "scroll" | "present"): SlideDef[] {
    const list: SlideDef[] = [{ key: "cover", title: "Capa", cover: true }];

    if (data.diagnosis || data.considerations.length > 0) {
      list.push({
        key: "diag",
        title: "Diagnóstico e condição",
        body: (
          <>
            {data.diagnosis && (
              <p className="whitespace-pre-wrap">{data.diagnosis}</p>
            )}
            {data.considerations.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {data.considerations.map((c, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      });
    }

    if (data.objectives) {
      list.push({
        key: "obj",
        title: "Objetivos do tratamento",
        body: <p className="whitespace-pre-wrap">{data.objectives}</p>,
      });
    }

    if (mode === "present") {
      // Uma foto por slide (só as escolhidas), imagem grande sem cortar.
      const chosen = data.photos.filter((p) => presentPhotoIds.includes(p.id));
      chosen.forEach((p, i) => {
        list.push({
          key: `foto-${p.id}`,
          title:
            chosen.length > 1
              ? `Imagens e exames (${i + 1}/${chosen.length})`
              : "Imagens e exames",
          body: (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={p.name ?? "imagem clínica"}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
              {p.name && (
                <p className="shrink-0 text-center text-sm text-muted-foreground">
                  {p.name}
                </p>
              )}
            </div>
          ),
        });
      });
    } else if (data.photos.length > 0) {
      list.push({
        key: "fotos",
        title: "Imagens e exames",
        body: (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.photos.map((p, i) => (
              <figure key={p.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setZoom(i)}
                  className="block w-full overflow-hidden rounded-lg border transition hover:border-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.name ?? "imagem clínica"}
                    className="aspect-[4/3] w-full object-cover"
                  />
                </button>
                {p.name && (
                  <figcaption className="mt-1 truncate text-xs text-muted-foreground">
                    {p.name}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        ),
      });
    }

    if (data.sessionGroups.length > 0) {
      list.push({
        key: "sessoes",
        title: "Plano de tratamento — sessão por sessão",
        body: (
          <div className="space-y-3">
            {data.sessionGroups.map((g, gi) => (
              <div key={gi}>
                <p className="font-semibold">
                  {g.quantity > 1 ? `${g.quantity}× ` : ""}
                  {g.procedure}
                </p>
                {g.repeatNote && (
                  <p className="text-xs text-muted-foreground">{g.repeatNote}</p>
                )}
                <ol className="mt-1 list-decimal space-y-0.5 pl-5">
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
        ),
      });
    }

    list.push({
      key: "proposta",
      title: "Proposta e investimento",
      body: data.option ? (
        <div>
          <ul className="space-y-2">
            {data.option.items.map((it, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-0"
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide opacity-80">
                Investimento total
              </p>
              {data.option.summaryLabel && (
                <p className="text-xs opacity-80">{data.option.summaryLabel}</p>
              )}
            </div>
            {data.option.totalLabel && (
              <p className="text-2xl font-bold tabular-nums">
                {data.option.totalLabel}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">
          O plano ainda não tem uma opção aprovada para apresentar.
        </p>
      ),
    });

    if (data.planningNotes) {
      list.push({
        key: "consid",
        title: "Considerações do planejamento",
        body: <p className="whitespace-pre-wrap">{data.planningNotes}</p>,
      });
    }

    list.push({
      key: "proximas",
      title: "Próximas etapas",
      body: (
        <ol className="list-decimal space-y-1 pl-5">
          {NEXT_STEPS.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ),
    });

    return list;
  }

  const scrollSlides = buildSlides("scroll");
  const presentSlides = buildSlides("present");
  const presentTotal = presentSlides.length;

  // Teclado no modo apresentação: setas / espaço avançam, Esc sai.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        setCurrent((c) => Math.min(c + 1, presentTotal - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrent((c) => Math.max(c - 1, 0));
      } else if (e.key === "Escape") {
        exitPresenting();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, presentTotal]);

  // Se o usuário sair da tela cheia (Esc/navegador), fecha o modo apresentação.
  useEffect(() => {
    const onFsChange = () => {
      if (typeof document !== "undefined" && !document.fullscreenElement) {
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function renderSlide(
    def: SlideDef,
    index: number,
    total: number,
    present: boolean
  ) {
    if (def.cover) return <CoverSlide data={data} present={present} />;
    return (
      <SlideShell
        index={index}
        total={total}
        title={def.title}
        clientName={data.clientName}
        present={present}
      >
        {def.body}
      </SlideShell>
    );
  }

  function onPresentClick() {
    // Com fotos, abre o seletor de fotos; sem fotos, inicia direto.
    if (data.photos.length > 0) setPresentSetup(true);
    else beginPresenting();
  }

  function beginPresenting() {
    setPresentSetup(false);
    setCurrent(0);
    setPresenting(true);
    // Tela cheia de verdade (best-effort; precisa do clique do usuário).
    if (typeof document !== "undefined") {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }

  function exitPresenting() {
    setPresenting(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  const currentIndex = Math.min(current, presentTotal - 1);

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 size-4" />
          Voltar
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onPresentClick} disabled={presentSetup}>
            <Play className="mr-1 size-4" />
            Apresentar
          </Button>
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
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 size-4" />
            Baixar PDF
          </Button>
        </div>
      </div>

      {/* Seletor de fotos da apresentação (antes de entrar em tela cheia). */}
      {presentSetup && (
        <div className="no-print mb-4 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          <p className="font-medium text-primary">
            Fotos na apresentação (uma por slide)
          </p>
          <p className="text-muted-foreground">
            Escolha quais fotos serão apresentadas. Cada foto marcada vira um
            slide.
          </p>
          <PhotoPicker
            photos={data.photos}
            selected={presentPhotoIds}
            onToggle={togglePresentPhoto}
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPresentPhotoIds(data.photos.map((p) => p.id))}
                className="rounded border px-2 py-0.5 hover:border-primary"
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setPresentPhotoIds([])}
                className="rounded border px-2 py-0.5 hover:border-primary"
              >
                Nenhuma
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPresentSetup(false)}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={beginPresenting}>
                <Play className="mr-1 size-4" />
                Iniciar apresentação
              </Button>
            </div>
          </div>
        </div>
      )}

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
              <PhotoPicker
                photos={data.photos}
                selected={gammaPhotoIds}
                onToggle={toggleGammaPhoto}
              />
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
        apresenta esta proposta ao cliente — use “Apresentar” para projetar em
        tela cheia ou “Baixar PDF” para enviar.
      </div>

      <div id="apresentacao" className="space-y-4">
        {scrollSlides.map((def, i) => (
          <div key={def.key}>
            {renderSlide(def, i, scrollSlides.length, false)}
          </div>
        ))}
      </div>

      {/* Modo apresentação — tela cheia, um slide por vez */}
      {presenting && (
        <div className="no-print fixed inset-0 z-40 flex flex-col bg-neutral-950">
          <div className="flex shrink-0 items-center justify-between px-4 py-2 text-white/80">
            <span className="text-sm font-medium">Modo apresentação</span>
            <button
              type="button"
              onClick={exitPresenting}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10"
            >
              <X className="size-4" /> Sair (Esc)
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <div className="h-full w-full max-w-4xl">
              {presentSlides[currentIndex] &&
                renderSlide(
                  presentSlides[currentIndex],
                  currentIndex,
                  presentTotal,
                  true
                )}
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-center gap-6 px-4 py-3 text-white">
            <button
              type="button"
              onClick={() => setCurrent((c) => Math.max(c - 1, 0))}
              disabled={currentIndex === 0}
              className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
              aria-label="Slide anterior"
            >
              <ChevronLeft className="size-6" />
            </button>
            <span className="text-sm tabular-nums">
              {currentIndex + 1} / {presentTotal}
            </span>
            <button
              type="button"
              onClick={() =>
                setCurrent((c) => Math.min(c + 1, presentTotal - 1))
              }
              disabled={currentIndex === presentTotal - 1}
              className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
              aria-label="Próximo slide"
            >
              <ChevronRight className="size-6" />
            </button>
          </div>
        </div>
      )}

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
